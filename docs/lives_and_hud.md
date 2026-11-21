# Lives, shield, energy and the bottom HUD

All code addresses refer to the EXEPACK-decompressed `COMIC.EXE` image.

## Spare lives, not the active player

`DS:0046` counts **spare Comics**. It starts at zero in the image. Startup at
`0x04f9` calls the award routine five times, then calls `0x2172` once to spawn
Comic: gameplay starts with **four lit helmets plus the active player**. The cap
is five spares (six attempts including the active one). Zero lit helmets means
the current attempt is the last; it does not immediately mean Game Over.

Death check `0x1867` tests the spare count **before** decrementing it. A spare is
consumed for respawn at the saved strip-entry position, `DS:75b3`. With no spares,
execution enters Game Over at `0x140a`. Inventory and pickup-state bytes survive
ordinary death. The web port now preserves them and waits for Enter/New game
after Game Over, rather than silently resetting lives and score. The original
proceeds to high-score handling and exits DOS; that exit behavior is not emulated.

Contact death at `0x1248` shows eight explosion frames, keeping Comic visible for
the first four. The shared death path at `0x184a` waits two ticks and then fifteen
ticks before checking spares. Falling uses the shared path without an explosion.
These paths are now reproduced, including the 24/16/8-row fall crop at sprite
Y=17/18/19 units and the extra one-tick wait before Game Over. Enemies and pickup
checks run during all eight explosion frames; the later waits freeze them. See
[Pickups, death and reset](pickups_and_death.md) for the original-code oracles and
the exact reset/preservation list.

## Extra-life awards and score conversion

- Every 50,000 displayed points: the base-100 score carry path at `0x2377`.
- Each treasure: Gems (`0x2431`), Crown (`0x244f`), Gold (`0x2473`).
- Shield pickup while already at full shield: `0x252d`.
- At the five-spare cap, `0x215d` queues six shield-refill steps and makes three
  separate 7,500-point additions, totaling 22,500 before further bonuses. Their
  carries can themselves invoke the extra-life routine.

## Shield and weapon energy

Shield at `DS:0047` has **six units**. Contact with an enemy removes one unit
through `0x21fc`. Losing the final unit is not fatal; the **next** contact while
already empty invokes death (`0x1b44`). The previous web subtraction of three
shield units and immediate death on reaching zero was incorrect.

Initial spawn, respawn and a non-full Shield pickup queue six refill steps at
`DS:d3fc`. The main loop at `0x167d` executes one step per DOS timer tick, so refill
is visible over time. A step while already full adds 1,800 points (`0x21d7`).

Weapon energy is separate: twelve units across six display cells. Odd values fill
half a cell, even values fill whole cells. Shield uses whole cells only.

## Recovered graphics

These routines copy **opaque color planes**, not masked sprite pixels. Preserve
gray cell borders, dark red energy, and the unlit helmet artwork.

| Export | Source DS offsets | Display geometry |
|---|---|---|
| `LIFE_ICONS` | `ace4`, `b6e4` | Lit/unlit 16×16; x=48,72,96,120,144, y=180 |
| `ENERGY_CELLS` | `ba04`, `ba44`, `ba84` | Empty/half/full 8×16; six cells at x=248..288, weapon y=54, shield y=82 |
| `FIREBALL_CAPACITY` | `a384 + 160*(9..13)`, alternate bank `+a00` | Counts 1–5, two states each, 16×16 at x=232,y=112 |
| `GAME_OVER` | `c6c4` | Original 128×48 panel, screen x=40,y=64 |

`SYS003` contains five **unlit** helmet cells and **empty** energy cells. Tests
compare the recovered graphics against those cells pixel-for-pixel. The old web
renderer incorrectly treated the screen as fully lit and hid cells with flat gray
rectangles. It now redraws each cell with the actual state graphic.

The Cola count is blank before the first can. Counts 1–5 use the original numbered
fireball graphics with an alternate bank. It is capacity, not a remaining-ammo count;
shooting does not decrement the number of cans. The player retains capacity on death.

`mechanics.json` contains constants, layout and source references. Gameplay state
and HUD drawing are implemented in `web/src/lives.js`. Run `node --test tests/*.mjs`
and `python3 -m unittest discover -s tests` after exporting assets for regressions.
