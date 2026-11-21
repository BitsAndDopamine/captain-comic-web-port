# Original enemy slots, spawning and AI

Implemented in `web/src/enemies.js`, from unpacked image `0x1ac0..0x2003`.
`main.js` runs this once per ~18.2065 Hz DOS tick, before moving/test-hitting
fireballs. The old hand-placed `spawns.js` is no longer imported.

## Runtime records

Four 12-byte records start at `DS:5b54`. Coordinates are sprite top-lefts in
eight-pixel units; the low position byte is Y, high byte X.

| Byte | Use |
|---:|---|
| 0,1 | Y,X |
| 2,3 | Horizontal direction, vertical direction/velocity |
| 4 | Inactive countdown **or** active animation counter |
| 5 | Animation steps (including repeated penultimate pose) |
| 6 | Behavior, after stripping bit 7 |
| 7,8 | Animation pointer-table address |
| 9 | State: 0 inactive, 1 active, 2–6 shot effect, 8–12 contact effect |
| 10 | Direction-bank pointer offset, 0 or 5 |
| 11 | Movement phase, initially 0 or 2 according to behavior high bit |

The high bit is a **cadence modifier**, not an extra placement or different AI.
Behaviors 1/5 alternate move/pause with phase 0/1, but phase 2 bypasses the pause.
Behaviors 2/3/4 compare for equality with phase 1 and increment an 8-bit counter;
the unusual high-bit variants retain that original wraparound behavior.

## Spawn/recycle schedule

- All four slot delays start at 20 on strip load. Decrementing **below** zero
  triggers an attempt on tick 21. This is not a guaranteed successful spawn.
- The shared candidate offset `DS:d441` starts at **22**, so the first attempted
  offset is **24**. It advances by 2 per attempted search, wrapping at 31 to 24.
  Earlier notes incorrectly described the initial value as zero/first offset 2.
- Facing right: candidate X = camera + offset. The code uses **JO**, a signed
  overflow test, not unsigned carry! Facing left: camera − (offset − 22), with
  unsigned-borrow rejection. Byte arithmetic is preserved in the port.
- Scan from Y = `(playerY & 254) + 4`, upwards by two units: find a solid tile,
  then skip solid rows until the first clear cell above terrain. This checks one
  tile column, not the enemy's entire footprint. Searches can fail; slots retry.
- `DS:d442` allows at most one regular spawn per tick. Behavior 127 clears this
  lock again, remains inactive and retries after a 100-tick countdown underflows.
- Recycling uses shared delays **20,40,60,80,100,20…**, then another underflow
  tick. `DS:d440` and `d441` survive strip loads; individual slot delays reset.
- An enemy 30 or more horizontal units from Comic is recycled. Active drawing is
  limited to camera-relative X 0..22; enemies can move while outside that window.

At the initial Forest position, the first candidate columns have no suitable
terrain. Correct behavior can therefore leave the screen empty until Comic moves;
do not force a bird into the scene merely because 21 ticks elapsed.

## Five movement routines

| ID | Routine | Behavior |
|---:|---|---|
| 1 | `1d1b` | Diagonal ricochet; horizontal camera-edge/terrain reversal, vertical ceiling/floor reversal |
| 2 | `1c31` | Hopping: aim toward Comic on takeoff, velocity −7 then +2/tick capped at 23; half-rate horizontal movement |
| 3 | `1db8` | Track Comic horizontally while supported; once falling, retain direction and descend one unit/tick |
| 4 | `1e45` | Pursue horizontally; pursue vertically only when horizontally aligned or blocked |
| 5 | `1ea6` | Horizontal patrol with vertical response to Comic's height and facing; retreats upward when he looks toward it |

Movement probes call the recovered equivalents of `DBA` (16px-wide row) and
`DF4` (16px-high column), including adjacent tiles for an odd coordinate. Tile
solidity is the existing TT2 cutoff rule. Positions, phases and velocity rounding
use the original integer/byte semantics, not continuous interpolated physics.

Animation advances every active tick, including movement-pause ticks. Direction
bank 0 is used for left movement, bank offset 5 for right. Only descriptors with
two source banks use separate artwork; e.g. a three-frame cycle with repeat flag
becomes `[0,1,2,1]`, and the other direction `[3,4,5,4]`.

## Contact and hit effects

These are **not generic AABB overlaps**:

- Player contact: `abs(enemyX-playerX)<2` and `0<=enemyY-playerY<4`.
- Fireball hit: `abs(fireballX-enemyX)<=1` and `0<=fireballY-enemyY<=1`.
- Enemy contact is processed before fireball movement/hits. A projectile awards
  300 points and consumes itself on the first matching active slot.
- The supplied executable moves shots, then removes those outside camera-relative
  X=0..22 units **before** testing hits (`0x2054..0x2078`, then `0x20d1`).
  Enemy drawing uses the same 0..22 top-left window, but the one-unit hit tolerance
  permits hitting an undrawn enemy at X=-1 or 23. Shots do not keep flying farther
  offscreen in this version; increasing that range would be a gameplay deviation.
- Contact consumes shield (or kills Comic if already empty) and starts a different
  five-frame effect from a shot. Slot recycling follows; enemies aren't permanently
  deleted. The original body remains behind the first three effect frames.
- `ENEMY_EFFECTS.png` is exported from pointer table `DS:a364`, including the
  unused intervening entry, so drawing can index it by runtime state minus two.

## Verification and limits

`tools/trace_enemy_ai.py` executes the unpacked 8086 instructions with Unicorn,
skipping only EGA drawing and player-contact side effects. Its committed fixtures
contain **1,440 individual movement cases** and **24 × 400 complete scheduler
ticks**, with the source image SHA-256. Node tests compare every runtime-record
byte and the shared scheduler bytes; no emulator is needed to run those tests.
Regeneration needs optional Python `unicorn`; normal asset export does not.

```sh
python3 tools/export_web_assets.py
python3 tools/trace_enemy_ai.py
node --test tests/test_enemies.mjs
```

The traces test actual terrain in all strips, byte boundaries, all five behavior
IDs and phase variants. Separate tests cover contact windows, first attempts,
one-spawn-per-tick, effects, persistent scheduler state and directional animation.

Player physics and camera scrolling now also run on the original DOS-tick model.
Enemy decisions follow the original routines **for their supplied player/camera
coordinates**. Enemy updates and the re-entrant contact guard during the eight
contact-death frames are now implemented and covered by the death-code oracle.
A complete DOS-versus-web playthrough comparison remains open.
