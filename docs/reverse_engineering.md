# Captain Comic: unpacked executable findings

All addresses below are **offsets in the EXEPACK-decompressed image**, not offsets
in the original file. `COMIC.EXE` is 34,297 bytes; its image expands to 100,208 bytes.
The main data segment starts at image `0x2740`. Add that base to a `DS:offset`
pointer to locate its data. Do not use a constant file-to-image offset after packing.

Reproduce the exports with `python3 tools/export_web_assets.py`, or run
`python3 tools/export_exe_assets.py` for just embedded graphics and world records.
The latter reuses `unpack_exepack()` from `tools/export_audio.py`.

## 1. Original graphics recovered

| Asset | DS-relative pointer | Image offset | Frames | Frame size |
|---|---|---|---:|---|
| Player, both directions | `0x75c0` | `0x09d00` | 10 | 16×32, 320 bytes |
| Player death explosion | `0x86a0` | `0x0ade0` | 8 | 16×32, 320 bytes |
| Teleport/arrival effect | `0x9460` | `0x0bba0` | 12 | 16×32, 320 bytes |
| Player fireball | `0x8240` | `0x0a980` | 2 | 16×8, 80 bytes |
| Items, two animation banks | `0xa384` | `0x0cac4` | 32 | 16×16, 160 bytes |
| Score digits 0–9 | `0xb784` | `0x0dec4` | 10 | 8×16, 64 bytes (no mask) |

The player selector at `0x0ec6` computes
`DS:0x75c0 + 320 * (facingBank + pose)`:

- Facing bank: 0 for right, 5 for left (`DS:d3fa`).
- Pose: 0 standing; 1, 2, 3 walking; 4 airborne (`DS:d3fb`).
- Walking pose counter cycles 1→2→3→1 at `0x1667`.

`web/assets/sprites/PLAYER.png` now contains all ten frames and `sprites.json`
records their animation indices. The web player uses the original DOS-tick walk/air
poses, horizontal momentum, jump/fall behavior, terrain probes and camera scrolling.
See [Player physics](player_physics.md) for original-instruction validation.

### The sprite-format mistake

The blitter at `0x0f8f` reads a color word through `SI` and an AND-mask word
through `BP`; the caller sets `BP = SI + 0x100` for a 16×32 sprite, or `SI + 0x80`
for 16×16. Each row performs:

```
screen = (screen & mask) | color
```

Thus **four color planes come first, followed by the mask**. Each plane stores
two bytes per row, MSB first. A mask bit of **1 preserves the background**, whereas
0 replaces it. All decoded source frames have zero color under transparent pixels,
so they translate exactly to RGBA. Opaque black is retained.

The same format applies to all 14 `.SHP` files. The earlier mask-first decoder was
wrong, shifting the color planes and transparency. Both the web assets and the 55
standard previews have been regenerated with the corrected shared decoder in
`tools/sprite_format.py`.

The firing routine uses the first two 16×8 pointer entries in `DS:a360` (`0x8240`,
`0x8290`), exported as `sprites/FIREBALL.png`. It draws two animation frames, not the
three full-height frames in `FB.SHP`.

### Missing SYS006/SYS007 revisited

The two filenames remain in the executable, but are **not needed to recover the
player**. No direct word references to their DS-relative addresses were found in
the main code. The old claim that the player frames were lost in those files was
an inference, now disproven by following the actual drawing routine.

## 2. World data: 8 areas, 24 strip records

The area loader at `0x0acc` indexes eight words at `DS:0x75a3` (image `0x09ce3`).
It changes the source segment to `0x0fdf`, then copies 203 bytes to `DS:0x74d8`.
Source records are padded to **208 bytes** and start at image `0x0fdf0`.

| ID | Area | Source image offset |
|---:|---|---|
| 0 | LAKE | `0x0fdf0` |
| 1 | FOREST | `0x0fec0` |
| 2 | SPACE | `0x0ff90` |
| 3 | BASE | `0x10060` |
| 4 | CAVE | `0x10130` |
| 5 | SHED | `0x10200` |
| 6 | CASTLE | `0x102d0` |
| 7 | COMP | `0x103a0` |

### 203-byte area-record layout

| Offset | Bytes | Meaning |
|---:|---:|---|
| `0x00` | 14 | Tileset filename, space padded and NUL terminated |
| `0x0e` | 42 | Three 14-byte playfield filenames |
| `0x38` | 4 | Tile IDs used by the transition animation |
| `0x3c` | 68 | Four 17-byte enemy-graphics descriptors |
| `0x80` | 75 | Three 25-byte strip records |

Each graphics descriptor has three configuration bytes followed by a 14-byte
filename: cycle-frame count, direction-bank count (1 or 2), and a flag to append
a repeated penultimate frame. The sprite loader (`0x0be2`–`0x0c74`) builds the
runtime animation pointers from these fields. Its file-size calculations agree
with every referenced `.SHP` file.

### 25-byte strip-record layout

| Offset | Bytes | Meaning |
|---:|---:|---|
| 0 | 1 | Pickup ID (frame index in the embedded item sheet) |
| 1 | 2 | Pickup position, **y then x**, in units of 8 pixels |
| 3 | 1 | Neighbor strip on the left, or `0xff` for none |
| 4 | 1 | Neighbor strip on the right, or `0xff` for none |
| 5 | 12 | Three doors: y, x, destination-area ID, destination-strip ID |
| 17 | 8 | Four enemy slots: graphics-descriptor index, behavior byte |

Door entries beginning `ff ff` are unused. There are **36 active door entries**.
Door handling at `0x16c3` checks the player's vertical coordinate, a horizontal
window of three coordinate units, and the door-key flag (`DS:004c`). The transition
routine at `0x1a95` changes area/strip; `0x0c75` finds the destination's reciprocal
door and places the player one horizontal coordinate unit to the right of its stored
interaction coordinate.
The loader exits if no matching reciprocal entry is found.

There are two distinct transitions:

- **Walking off a strip edge stays in the same area.** The edge routines at `0x19ca`
  and `0x1a26` read strip-record bytes `+3` (left) and `+4` (right). `0xff` means
  no connected strip. A left crossing enters the linked strip at horizontal unit
  `0xfe`; a right crossing enters at unit 0. Vertical position is retained.
- **Changing area uses a keyed door, not an area-end flag.** Hold the configured
  door key (default Alt) and carry the Door Key. When the door test succeeds, bytes
  `+2/+3` select target area/strip. `0x1a95` saves the old pair, sets the target pair,
  then calls the area loader `0x0acc` if the area changed or strip loader `0x0c75`
  otherwise. The destination strip must contain a door pointing back to the old pair;
  that reciprocal door supplies the arrival coordinate. A strip with no right link
  does **not** automatically advance to a different area.

`web/assets/world.json` exports all records with both raw 8-pixel coordinates and
pixel coordinates, filenames, source offsets and original strip bytes.
The web port now follows connected left/right strip links at the map edges and
supports reciprocal Door-Key transitions with the configured Alt key. The debug
`1/2/3` and `[`/`]` shortcuts remain available.
Door interaction and arrival coordinates are converted between the original 16×32
sprite and the web port's provisional 12×15 collision box (`web/src/doors.js`).
Do not compare a door's Y directly with `player.y`: that is the collision-box top,
17 pixels below the sprite top. This previously prevented grounded door use.

### Door animation and key requirements

The original game has **one reusable Door Key**, pickup ID 1. The door-use path
at image `0x16e6` checks only `DS:004c == 1`; the item handler at `0x23e1` sets
that byte. No per-door color/key-type comparison or key consumption occurs.
Different-colored door artwork does not imply a different key. All 36 linked door
entries use this master key, but only the nearby door at the correct height can
be activated. The web port retains that original rule rather than inventing keys.
This was independently re-checked by executing the original instructions for
2,016 selection cases and all 36 transitions: see [Door Key verification](doors_and_keys.md).

Departure routine `0x1111` calls the shutter renderer at `0x1179`, the 32×32 black
opening at `0x120a`, and the player draw routine. It displays partial/open/partial
door states, then hides the player before switching area/strip. Arrival routine
`0x1094` waits three timer ticks and shows the reverse opening/closing sequence
with the player reappearing. The shutters come from four area-record tile IDs at
offset `0x38` (`DS:7510` after loading): an 8-pixel-wide inner half of each tile
is placed on the left/right sides of a 32×32 opening. These are not teleport sprites.

The exported `mechanics.json` now records the key rule, source routines and frame
durations. The web renderer uses the area's tile halves on both sides of a door
transition, freezes movement/combat during the sequence, and resumes at the
reciprocal door after arrival. Debug strip/area selection cancels an active sequence.

### Pickups

The dispatch at `0x2528` maps item IDs to code, independently confirming the names:

| ID | Kind | Key state/behavior |
|---:|---|---|
| 0 | Corkscrew | `DS:004b = 1` |
| 1 | Key | `DS:004c = 1` |
| 2 | Boots | `DS:004a = 5` |
| 3 | Lantern | `DS:004d = 1` |
| 4 | Wand | `DS:004e = 1` |
| 5 | Gems | Increments treasure counter, extra-life routine |
| 6 | Crown | Increments treasure counter, extra-life routine |
| 7 | Gold | Increments treasure counter, extra-life routine |
| 8 | Cola | Increments fireball capacity (`DS:0048`), capped at 5 |
| 14 | Shield | Recharges shield; invokes extra-life routine when already full |

Pickup renderer `0x2491` switches between two item-graphics banks separated by
`0x0a00` bytes. There is one persistent pickup-state byte per area/strip at
`DS:0054 + strip*16 + area`. Collection awards 20 stored score units through
`0x2343`, equivalent to **2,000 displayed points** (see score format below).
Pickups are stationary at their recorded coordinates; only their two graphics
banks alternate (the routine toggles its bank after every second pickup draw).
The web port now uses the original 16×16 `ITEMS` frames and retains collected state
when revisiting a strip. For example, the Door Key is in **FOREST strip 2 at
(1280,16) pixels**—it is not in strip 0 as the old hand-placed spawn suggested.

All 24 pickup records (world pixel coordinates, sprite top-left):

| Area | Strip | Pickup | x | y |
|---|---:|---|---:|---:|
| LAKE | 0 | Cola | 896 | 96 |
| LAKE | 1 | Shield | 1424 | 80 |
| LAKE | 2 | Cola | 992 | 32 |
| FOREST | 0 | Cola | 96 | 112 |
| FOREST | 1 | Shield | 944 | 80 |
| FOREST | 2 | **Key** | **1280** | **16** |
| SPACE | 0 | Cola | 80 | 128 |
| SPACE | 1 | Shield | 912 | 64 |
| SPACE | 2 | Gems | 1584 | 48 |
| BASE | 0 | Shield | 2016 | 32 |
| BASE | 1 | Corkscrew | 0 | 128 |
| BASE | 2 | Boots | 1840 | 128 |
| CAVE | 0 | Shield | 328 | 48 |
| CAVE | 1 | Gold | 1824 | 32 |
| CAVE | 2 | Wand | 512 | 80 |
| SHED | 0 | Shield | 1296 | 96 |
| SHED | 1 | Cola | 2000 | 32 |
| SHED | 2 | Shield | 1968 | 80 |
| CASTLE | 0 | Crown | 1952 | 16 |
| CASTLE | 1 | Shield | 528 | 112 |
| CASTLE | 2 | Shield | 352 | 64 |
| COMP | 0 | Shield | 1120 | 16 |
| COMP | 1 | Shield | 560 | 80 |
| COMP | 2 | Lantern | 1328 | 16 |

The executable's initial state is FOREST strip 0, player coordinate x=14, y=12
(112,96 pixels in the original drawing coordinate system). The web game now uses
that original start rather than the former hand-placed x=545. With the provisional
12×15 collision box, this means hitbox (114,113), sprite (112,96), feet y=128.

### Fireballs, Cola and Corkscrew

The five projectile records are six bytes each at `DS:d450`; an empty position word
is `ffff`. The firing routine at `0x2004` scans only as many records as `DS:0048`
allows. This capacity starts at zero; each Cola increments it, capped at **5**.
The original projectile uses the first two 16×8 frames from `DS:a360` (`0x8240`,
`0x8290`), exported as `sprites/FIREBALL.png`.

`DS:0049` is separate weapon energy, initially zero and capped at 12. It recharges
one unit every two BIOS timer ticks while fire is released. A fire tick consumes one
unit; the code attempts one shot per tick, even if every projectile slot is occupied.
The timer runs at approximately 18.2065 Hz. A shot starts at the player's X and one
8-pixel coordinate unit below the player's Y, then moves horizontally by two units
(16 px) per timer tick. It is culled outside the visible camera range and has no
terrain collision test.
In the web port this firing coordinate must be converted from the player's drawn
16×32 sprite, not its provisional 12×15 hitbox. `fireballOrigin()` uses
`spriteY + 8`; adding 8 directly to `player.y` previously put shots 17 pixels too low.

Collecting Corkscrew sets `DS:004b`. The projectile moves down by one coordinate
unit (8 px) on one update, then back up on the next; the two-tick cycle repeats.
The web port now models the zero
initial capacity/energy, Cola slots, timer-rate fire, the 16×8 two-frame sprite, and
the Corkscrew wave.

### Enemy configuration is not placement

There are **four runtime enemy slots per strip**, hence 96 exported configurations.
The initializer at `0x0d21` strips the high bit from the behavior byte and sets
the slot's phase to 2 when that bit was set. This changes movement cadence; see
[Enemy AI](enemy_ai.md) for the byte-state semantics. Behaviors dispatch at `0x1af3`:

| Code | Update routine | Observed code behavior |
|---:|---|---|
| 1 | `0x1d1b` | Horizontal/vertical movement, reverses at collisions/bounds |
| 2 | `0x1c31` | Gravity and jumping/bouncing with terrain collision |
| 3 | `0x1db8` | Vertical falling and horizontal player tracking |
| 4 | `0x1e45` | Player-directed pursuit with tile collision |
| 5 | `0x1ea6` | Pursuit with direction/line-up conditions |
| 127 | Special spawn path `0x1f5f` | No ordinary 1–5 movement dispatch |

Enemies are spawned dynamically relative to the camera/player, not at static map
coordinates. `world.json` deliberately does **not** invent spawn x/y positions.
The web port now uses the original spawn scheduler and all five movement routines
in `web/src/enemies.js`, including directional animation, contact/hit windows,
effects and staggered recycling. `web/src/spawns.js` is historical and unused.

## 3. Other confirmed mechanics / leads

### Dynamic enemy spawning

The four enemy entries are **slots**, not four fixed placements. On strip load,
`0x0d15` initializes each 12-byte runtime record at `DS:0x5b54 + slot*12`: the
graphics pointer, behavior ID, inactive state, a 20-tick delay and optional phase
bit are copied from the strip record. The main update at `0x1ac0` decrements that
delay once per game tick; when it wraps below zero, it invokes the spawn routine at
`0x1f5f`. At the BIOS timer cadence, this is about 21 ticks (roughly 1.15 seconds).

Spawn positions are chosen **during play**:

1. `DS:0xd441` advances by 2 coordinate units, initially 22 (first candidate 24); at `0x1f` it wraps
   to `0x18`. If facing right, candidate X is `cameraX + offset`; if facing left,
   it is `cameraX + 22 - offset`. The right path tests signed overflow (JO), while
   the left path tests unsigned borrow; preserve that difference.
2. Candidate Y starts at `(playerY & 0xfe) + 4` and scans upward by two 8-pixel
   units. It uses the same `tile ID > TT2 header cutoff` test as player collision:
   find terrain, continue through it, then place the enemy in the first clear cell
   above its top surface. A column with no suitable terrain is skipped.
3. If it finds a suitable surface and no other slot has spawned this tick, the
   slot becomes active. `DS:0xd442` is the per-tick spawn lock.

Behavior byte `0x7f` is a special/no-normal-motion slot: it is deactivated and
re-queued with a 100-tick delay rather than entering the regular behavior 1–5
dispatch. The high bit on other behavior values is removed during initialization
and seeds a movement-cadence field. Consequently `world.json` exports enemy
graphics/behavior slots but not invented x/y placements. The dynamic scheduler is
now implemented and compared with 24×400 ticks of original machine-code execution;
see [Enemy AI](enemy_ai.md). Shared respawn delays cycle 20,40,60,80,100 ticks.

- Coordinates are stored in one word with **AL = vertical**, **AH = horizontal**.
  `0x0d97` converts them into a map address: `(y >> 1)*128 + (x >> 1)`.
  Graphics coordinates use units of 8 pixels; maps use 16-pixel tiles.
- Tile solidity is `tile ID > first TT2 header byte`; signed comparisons are safe
  for these resources because all tile IDs/cutoffs are below 128.
- All TT2 map tiles are opaque, including tile ID **0**. It is not an empty-cell
  sentinel: Lake/Shed tile 0 is cyan (palette index 11), Base tile 0 is gray (7),
  and Castle/COMP/Space tile 0 contains background patterns. The previous web
  optimization that skipped tile 0 produced black sky/panel holes. The shared
  tile renderer now draws every visible cell; `tests/test_tilemap.mjs` covers all
  eight areas and all three strips, including fractional-tile camera positions.
- The CASTLE blanking branch at `0x0b14` checks area ID 6 and `DS:004d`. The pickup
  dispatch now identifies `004d` as the **lantern flag**: this is dark-area rendering,
  **not anti-tamper protection**. It clears tile graphics without clearing the cutoff.
- SPACE (area 2) subtracts 2 from vertical acceleration before the ordinary +5
  update (`0x18e8`), yielding a lower-gravity area. Do not apply the web's uniform
   gravity everywhere when implementing exact physics.
- Player movement, jump boosts, Boots, air momentum and asymmetric terrain probes
  have now been traced from the original instructions. Research and measured jump
  heights are in [Player physics](player_physics.md). Vertical jump/fall is implemented;
  horizontal momentum/side probes/camera remain open. Boots, Wand and Lantern are
  documented in [Item abilities](item_abilities.md).
- Score format and caps are exported as reference data in `web/assets/mechanics.json`.

### Score format and original digit font

The renderer at `0x238b` takes each base-100 byte and draws its tens and units from
the glyph table `DS:b784` (image `0x0dec4`). Each glyph is four 16-byte color planes,
**without a mask**, representing an 8×16 cell. Black pixels erase the previous digit.
The ten glyphs are exported to `web/assets/sprites/SCORE_DIGITS.png`.

Score bytes `DS:0050`, `0051`, `0052` hold six dynamic digits in least-significant
group-first order. Two rightmost zeroes remain static in SYS003's HUD. Thus:

```
displayedPoints = 100 * (byte50 + 100 * byte51 + 10000 * byte52)
```

The dynamic cells occupy x=232,240,…,272 at y=24; static zeroes occupy x=280,288.
Cell pitch is **8 pixels**, not the screenshot-based 9-pixel estimate previously
used in `hud.json`. The web renderer now uses these original glyphs and score scaling.

On each carry out of the low base-100 byte, `0x2377` increments `DS:0053`. After
five carries it awards an extra life, i.e. **every 50,000 displayed points**.
Confirmed increments in displayed units are:

- Projectile destroying an enemy: AL=3 → **300** (`0x211b`).
- Collecting an item: AL=20 → **2,000** (`0x2507`).
- Extra-life award while already at the five-spare cap: three AL=75 increments →
  **22,500**, plus a six-step shield-recharge request (`0x215d`).

Original HUD limits are six shield units (`0x21d7`), twelve weapon-energy units
(`0x2226`) and five cola/fireball-capacity upgrades (`0x22c1`). The web port now
draws six energy cells with the original empty/half/full states rather than the
former uniform ten-segment approximation.

## 4. Original startup sequence

For the spare-life counter, extra-life awards, death sequence and exact lit/unlit
HUD assets, see [Lives and HUD](lives_and_hud.md). The web port now starts with
four spare helmets, uses six-unit shield recharge, and renders the original life,
energy and fireball-capacity cells rather than gray overlays.

`web/assets/startup.json` exports the startup sequence, its source addresses and
the two original text pages decoded with XOR `0x25`. `web/src/startup.js` controls
the browser sequence without running gameplay physics behind the intro.

| Stage | Source | Behavior |
|---|---|---|
| Shareware notice | Code `0x0149`, text DS:0194 / image `0x028d4` | Original 80-column Revision 5 notice; R opens registration details |
| Title | `0x0434`, `SYS000.EGA` | Starts the opening theme; 5 palette-step ticks plus 14 hold ticks |
| Story | `0x045b`, `SYS001.EGA` | Five palette ticks, then first BIOS key wait at `0x04d7` |
| Items/enemies legend | `0x04cd`, `SYS004.EGA` | Second key wait at `0x04e1` |
| Planet Tambi / HUD | `SYS003.EGA`, `0x04e5` onward | Five life-counter ticks followed by three more ticks before loading the area |
| Teleport arrival | `0x159d` | 15-tick wait, 12 consecutive 16×32 effect frames, 1 settle tick; player appears during the last 6 frames |
| Gameplay | `0x161f` | FOREST strip 0, sprite top-left (112,96), initial camera x=24 |

**SYS002 is not part of startup**: it is loaded by the treasure-completion path at
`0x14e3` and depicts the ending. SYS005 is the high-score screen. Initial arrival
uses the teleport animation because `DS:003e` starts at `0xfe`; the strip loader's
branch at `0x0d73` selects `0x159d` for this value. The initial position is stored
at DS:75b3 (image `0x09cf3`) as bytes `0c 0e` (Y=12, X=14). The camera formula at
`0x0cf1` is `clamp(xUnits - 11, 0, 232)`, hence `(14-11)*8 = 24` pixels.

The browser displays the original graphic PNGs at native logical resolution and
uses the original screen order and timer cadence. It shows original notice and
registration text in a readable DOM text panel, not a DOS text-mode emulator.
K/J explain the fixed browser controls instead of emulating hardware configuration;
Escape returns to the menu rather than closing the browser. The original five-step
palette reveal is applied to title/story/ending using mode 0Dh's 200-line RGBI
mapping, not the independent 350-line EGA RGB mapping. See
[Colors and transitions](colors_and_transitions.md). The browser animates the
five startup life awards and consumes one before arrival, leaving four spares.
Enter or the Continue button advances the notice/story/legend, while title, planet
and teleport stages run on timers. The title theme begins on a user gesture and is
stopped when leaving the legend, as the DOS life-initialization path cancels it.

## Verification and limits

`python3 -m unittest discover -s tests` checks sprite sizes, plane/mask semantics,
source-table consistency and the generated world records. The web export validates
enemy descriptor frame counts against source files and rejects malformed targets.
`node --test tests/test_doors.mjs` covers grounded door detection, key requirements,
Lake arrival height and coordinate round-trips for all 36 doors.
`node --test tests/*.mjs` additionally covers firing origins, startup ordering,
key-wait boundaries, teleport arrival frames and original spawn/hitbox conversion.

All original `game files/` are read-only inputs. Enemy AI/spawning, player movement,
victory/high scores, pickup windows/cadence, and death/reset behavior now have
original-code-backed implementations. See [Pickups, death and reset](pickups_and_death.md)
for the explosion's nested enemy updates and pickup checks. Full-playthrough
comparison and remaining same-tick edge cases still need work.
The web Game Over restart is a browser convenience, not the original DOS exit path.
