# Boots, Wand and Lantern

These three remaining tool abilities are now implemented. Items are collected
from the original world records, remain in inventory after ordinary deaths and
are cleared only by New game. Door/key behavior is unchanged by this work.

## Boots: the extra jump-boost tick

The handler at unpacked image `0x23f5` writes 5 to `DS:004a`, previously 4.
That is a jump-boost counter, not a speed multiplier. `vertical_motion.js` now
implements the original DOS-tick vertical routine: signed velocity rounding,
held-jump boosts, gravity, head probes and landing snaps. `player.js` converts
between original sprite coordinates and the retained web box.

Controlled held-jump rises are **56px normally**, **72px with Boots**, and
**88px in SPACE without Boots**, matching original instruction traces. Releasing
the jump key (Up arrow in the web port) early suppresses remaining boosts; holding
it through landing does not automatically jump again. SPACE's lower gravity is
applied by the same routine.

Horizontal movement, side-wall collision, air momentum and camera scrolling also
use the original DOS-tick routines; see [Player physics](player_physics.md).
A short browser jump press is buffered until the next gameplay tick so a sub-tick
tap is not silently lost. Full-playthrough verification remains open.

## Wand: Caps Lock, while grounded

The acquisition handler at `0x241d` sets `DS:004e`. The original input path checks
that flag before calling `0x1298`; airborne movement bypasses this path.

`items.js:wandDestination()` reproduces target selection:

1. Aim six 8px units (48px) in the facing direction, then align X to a 16px column.
   An odd starting X can therefore make the actual displacement 40px or 56px.
2. Enforce the original viewport-relative limits (left requires at least six
   units of space; right rejects relative X >=17) and calculate camera movement.
3. Scan upwards from Y=18 units (144px), finding terrain followed by **two clear
   tile rows**. The second clear row is the destination sprite top-left. Starting
   height does not determine landing height, and intervening walls are not tested.
4. If no suitable landing exists, keep the original position. The original still
   requests its sound/effect; the port does too. No item is consumed.

The camera calculation retains the original signed `JLE` at `0x12e9`, including
its low-camera byte-wrap quirk. The camera moves by one unit per animation tick
while its pending counter is nonzero; it does not finish arbitrarily many pending
camera steps after the six-tick effect.

### Six animation ticks (`0x1348`)

The table at `DS:a37a` points to three unique 16×32 graphics at `DS:90a0`, `91e0`,
`9320`, sequenced `[0,1,2,1,0]`. These are **not** the twelve startup-arrival frames.
They are exported as `WAND_SHIFT.png` plus the animation sequence in `sprites.json`.

| Phase | Origin effect index | Destination effect index | Player |
|---:|---:|---:|---|
| 0 | 0 | — | Origin |
| 1 | 1 | 0 | Origin |
| 2 | 2 | 1 | Origin |
| 3 | 3 | 2 | Destination |
| 4 | 4 | 3 | Destination |
| 5 | — | 4 | Destination |

The `teleportShift` sound (`sound_04`, priority 2) is requested once per activation.
Walking/jumping/new shots and weapon-energy recharge pause during the effect;
shield refill, enemies, existing projectiles and pickup checks continue. Contact
can still kill Comic. Teleport does not replace the strip-entry death checkpoint.
Debug strip/area changes and death cancel the effect.

Browser control is one activation per Caps Lock press; OS key repeat and Caps Lock's
toggle state do not cause repeated casts. The DOS held-control retrigger behavior
is intentionally not reproduced. Full horizontal/camera physics remains separate.

## Lantern: Castle terrain visibility

The acquisition handler at `0x2409` sets `DS:004d`. The area loader at `0x0b14`
checks area ID **6 (CASTLE)** and that flag. Without the Lantern it zeros tile
artwork starting at `DS:0c44` but **preserves** the solidity cutoff at `DS:0c40`.
It does not darken enemies, Comic, projectiles, pickups or HUD graphics.

The web renderer reproduces this without modifying shared assets: Castle tile
art and door-shutter art are hidden over black; sprite drawing and collision
continue normally. All three Castle strips are affected. Other areas remain lit.
No invented light radius, fog, timer or battery is added. Inventory acquisition
updates visibility immediately, including when manipulated in the developer console.

## Verification

- `tools/trace_items.py` executes the original target selector for **2,016 cases**
  across all 24 strips, both directions, camera boundaries and blocked targets.
- It also executes all **16 combinations** of area/Lantern flag through the actual
  tile-blanking branch, checking that the tile header remains intact.
- The fixture contains the source-image SHA-256. Normal Node/Python tests need no
  emulator; regeneration requires optional Python `unicorn`.
- Tests compare vertical trajectories and velocities with the existing original
  player traces and verify integrated 60Hz-to-DOS-tick jump heights.
- Browser checks cover actual pickups, Caps Lock input, gate conditions, both
  effect positions, continued enemy updates, no firing during teleport, original
  checkpoint retention, Castle pixels and inventory persistence after death.
