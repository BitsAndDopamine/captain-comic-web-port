# Player physics and hitbox research

The original **horizontal movement, air momentum, terrain probes, camera and
vertical jump/fall** are implemented in `player.js` and `vertical_motion.js`.
Game movement shares the DOS-tick clock with combat. The 12×15 web box remains a
legacy coordinate adapter, not a terrain or pickup collision rectangle: movement
and pickup checks convert it to the original 16×32 sprite coordinates.

## Timing and coordinates

The original player update runs once per BIOS tick (~18.2065 Hz), along with
enemies. `DS:0042` stores sprite top-left Y then X, each in **8px units**. The
drawn sprite is 16×32; movement is quantized, not subpixel interpolation.

Ground movement (`0x19bc`, `0x1a18`) moves one unit (**8px/tick**, about
145.65px/s). Changing facing consumes a grounded tick before moving. Camera
scroll has a 10..12 unit dead zone, bounded by camera units 0..232. A successful
left step below offset 10 scrolls left one unit; a successful right step above
offset 12 scrolls right one unit. Standing still, turning or hitting a wall never
recenters the camera. Strip/door/death initialization centers at sprite X−11 units,
clamped to those bounds (`0x0ceb..0x0d04`). The original signed right-offset check
is retained. Rendering still snaps its camera defensively to prevent Firefox seams.

## Jump, gravity, Boots and SPACE

Airborne updates: `0x18a4..0x19bb`.

- `DS:d3f6` is signed vertical velocity; displacement is `velocity >> 3`
  (arithmetic shift), then multiplied by 8px. Negative rounding matters:
  **−1 still moves up 8px**, while +1..+7 do not move down yet.
- A normal jump-counter starts at **4** (`DS:004a`); Boots change it to **5**.
  Each airborne tick decrements a copy (`d3f8`). While it remains nonzero and
  jump is held, subtract **7** from velocity. At zero it is restored to 1 and
  no more boosts occur until jump is released on the ground. Holding jump does
  **not** repeatedly auto-jump upon landing.
- Apply movement first, then add **5** to velocity (normal areas), or **3**
  in SPACE (area 2 subtracts 2 before +5). Clamp velocity at **23**; its largest
  normal falling displacement is therefore two units/16px per tick.
- Releasing jump suppresses remaining boosts; there is no web-style immediate
  `JUMP_CUT = -3` or separate held/unheld gravity constant.
- Stepping off an edge initializes falling velocity to **8** and reduces the
  horizontal-momentum magnitude from 5 to **2** (or leaves it zero if stopped).

Executing the original instructions on a flat floor at sprite Y=12 units gives:

| Case | Highest sprite Y | Rise | First landing tick |
|---|---:|---:|---:|
| Normal, held | 5 | **56px** | 10 |
| Normal, one-tick tap | 10 | **16px** | 4 |
| Boots, held | 3 | **72px** | 13 |
| SPACE, held, no Boots | 1 | **88px** | 17 |

These are controlled flat-floor measurements, not universal clearances through
every ceiling/ledge. Tick counts include the tick which starts the jump.

## Air control

`DS:d3f5` is signed **horizontal momentum**, not pixels-per-tick velocity.
Ground left/right set it to −5/+5. In air, left/right subtract/add one, clamped
to ±5; then it decays one step toward zero. The corresponding movement routine
is called once according to the pre-decay sign, so displacement is at most one
8px unit/tick. Existing momentum can persist after release and takes time to
reverse. Beginning a stationary jump behaves differently from a running jump.

Both direction keys are processed left then right, not collapsed into a zero
direction. Grounded opposing inputs can therefore turn twice without moving;
airborne inputs update facing independently of the direction of drift. A wall or
unlinked strip boundary clears momentum. A linked boundary is crossed only when
attempting a step beyond sprite X=0/254; arrival uses X=254/0, preserves momentum,
facing and airborne state, and resets vertical velocity (`0x1a76..0x1a92`).

The walk pose cycles 1–3 on the DOS timer and is selected only by a successful
step; turning/blocked/idle ticks use pose 0. Unlanded airborne ticks use pose 4.
Short browser jump presses are queued until the next DOS tick; releasing jump
while grounded rearms the boost counter. Up arrow jumps; Space fires in the web port.

## There is no single terrain rectangle

The original addresses tile rows/columns directly. Offsets below are relative
to the **sprite top-left**, in 8px units:

| Test | Probe(s) | Code |
|---|---|---|
| Left wall | `(x−1,y+3)` | `19e2` |
| Right wall | `(x+2,y+3)` | `1a41` |
| Standing support | `(x,y+4)`, plus adjacent column if X is odd | `172e` |
| Ceiling during ascent | `(x,y)`, plus adjacent column if X is odd | `194d` |
| Landing while falling | `(x,y+5)`, plus adjacent column if X is odd | `197e` |

Side collisions sample the **lower body at y+24px**, not the entire 32px sprite.
A tile beside the upper body alone does not prevent walking; a tile at knee
height does. Head collision zeroes upward velocity and queues a one-unit
downward correction on the following tick (`DS:d3f7`). Landing snaps Y with
`(y+1)&254`, clears airborne and vertical velocity; the landing guard also
avoids snapping from the bottom-of-screen fall/death path.

The odd-X adjacent-column checks matter because 8px movement can straddle two
16px tiles. A larger generic AABB would make ledges and door platforms behave
differently. Enemy contact uses yet another coordinate window (now implemented):
`abs(enemyX-playerX)<2` and `0<=enemyY-playerY<4`, i.e. inclusive integer
offsets −8/0/+8px horizontally and 0/8/16/24px vertically. This must not be
confused with a symmetric 16×32 AABB or the provisional web box.

## Reproducible evidence and implementation follow-up

`tools/trace_player_physics.py` executes the original update instructions from
`0x1698`, stopping at `0x176b` before rendering/combat, at fall/death, or immediately
after the linked-strip vertical reset. Synthetic maps isolate
held/tapped jump, Boots, SPACE, turning, running-jump inertia, head collision
and lower-body versus upper-body side probes, opposing inputs, camera scrolling,
edge falls and grounded/airborne strip boundaries. A deterministic 1,572-case
single-tick matrix additionally exercises all 24 original maps, including every
one of the 36 door arrival positions. Output with source-image SHA-256
is in `docs/player_physics_traces.json`. Optional dependency: Python `unicorn`.
`mechanics.json.playerPhysics` exports constants with `verticalImplementedInWeb: true`
and `implementedInWeb: true`. `tests/test_player_motion.mjs` compares position,
airborne state, momentum, velocity, head correction, boost counter, facing,
camera, animation pose and death/strip exits to the original instructions.
Python tests guard source constants and key traces.

## Browser integration checks

All 36 door transitions and all 26 directed strip links were checked in the game,
including sprite-coordinate arrivals, camera initialization, Boots persistence,
airborne state/momentum and the strip-link vertical reset. A controlled 60-frame
run advances 18 DOS ticks and moves 144px, rather than updating movement at 60Hz.
This is not a substitute for the remaining full-game playthrough verification.
