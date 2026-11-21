# Exact pickups, death and reset

Original-code-backed behavior in `entities.js`, `death.js`, `main.js`, and
`lives.js`. Addresses refer to the unpacked executable image.

## Pickup window, cadence and drawing

`0x17de` checks the current strip's pickup flag and camera visibility before
calling `0x2491`. Coordinates are **sprite top-lefts in eight-pixel units**, not
the legacy 12×15 browser coordinate box:

- Horizontal distance is strictly less than 2 units: −8, 0 or +8 pixels.
- The pickup Y must be 0–3 units (0–24 pixels) below the player's sprite Y.
  Pickups at head height are valid; the old web AABB missed those cases.
- Pickup X relative to camera is 0–22 units. Outside that window the original
  neither collects nor draws it. The subtraction uses byte semantics.
- Checks run once per DOS gameplay tick, **after enemy contact and projectile
  processing**, not once per 60Hz browser step. Fatal contact interrupts that
  outer tick, but immediately starts a new pickup pass inside explosion frame 0.
- Each eligible, uncollected, non-contact pass advances shared DS:d490 and
  alternates the item's two graphic banks. Render calls do not advance it;
  offscreen checks and collected pickups do not advance it either. This state
  persists across strip changes and ordinary deaths.
- A successful pickup awards its 2,000 points, marks the area/strip flag, then
  applies its item handler. Full-shield/treasure extras and score-earned lives
  retain their original ordering. Boots changes the equipped boost value, not
  the in-progress jump counter; the ordinary grounded key-release path rearms it.

Drawing follows original gameplay layering: terrain, player/Wand, enemies,
projectiles, then pickups. The explosion is above enemies but below any remaining
pickup. This change does not alter the deferred door/key behavior.

## Contact death

The fatal enemy sets its effect state to 8 and raises DS:d443 before calling the
eight-frame routine at `0x1248`. It **re-enters the enemy scheduler immediately**:
frame 0 is processed in the same tick as fatal contact, not one tick later.

Each frame redraws terrain, draws Comic under frames 0–3, updates all enemy slots,
draws the original PLAYER_DEATH effect, checks the pickup, flips, and waits one
tick. The guard suppresses recursive deaths but still permits contact effects and
damage sound requests, even with zero shield. Projectile movement, weapon energy,
shield refill, player movement and the victory countdown are not advanced.

**A pickup during the explosion still counts.** In particular, a treasure or
score extra can award a spare before the final check, saving an otherwise last
attempt. A third treasure arms victory, but its countdown waits through death and
respawn. The already-running explosion is not cancelled by collecting an item.

After eight frames, terrain alone is displayed for two ticks, then the life-loss
cue plays and the game waits fifteen ticks. Enemies/pickups freeze during these
later waits. Thus the spare-life check occurs 25 ticks after contact-death entry.

## Falling and final Game Over

`0x181b` skips the explosion. At sprite Y=17,18,19 units, it shows the top 24,16,8
rows of the airborne player for one tick, respectively. This is an explicit crop
to the 160-pixel terrain bottom, not just the taller web playfield clip. Y≥20
skips the crop. Then come the same two blank + fifteen life-loss ticks.

If no spare remains at the check, the original Game Over panel is prepared and
waits **one additional tick** before its page flip and cue. The normal high-score
acknowledgment follows. No pickups or enemy bodies are drawn on this final panel.
Projectile slots are frozen/hidden during death and cleared on respawn, not erased
as a side effect of the initial contact.

## Respawn state

`0x1871..0x18a1` consumes one spare and jumps to strip initialization `0x0cd5`, not
to the initial teleport-arrival routine:

| Reset | Preserved |
|---|---|
| Position = saved strip-entry DS:75b3 | Area/strip, inventory and collected pickup flags |
| Camera = clamp(spriteX/8−11,0,232)×8 | Score/carry, treasures, Cola capacity and weapon energy |
| Airborne/momentum/vertical velocity = 0 | Facing bank |
| Animation phase/pose = 0 | Ceiling correction DS:d3f7 (the original does not reset it) |
| Jump counter = **4**, even with Boots | Equipped Boots boost (5) |
| Shield = 0; refill queued for six ticks | Shared enemy respawn-delay/spawn-offset counters |
| Weapon recharge countdown = 2 | Pickup bank counter and pending victory countdown |
| Projectile slots inactive; Wand cancelled | Inactive enemy coordinate/direction bytes |
| Enemy state/bank reset, delay=20, behavior seed restored | — |

Holding jump throughout a Boots death can therefore use counter 4 on the first
immediate jump. Releasing jump while grounded rearms the equipped counter 5.
The web keeps the original retained ceiling-correction quirk too. Inactive enemy
coordinates are retained but do not render; the normal spawn path reinitializes
them when needed. The checkpoint is not changed by Wand teleportation.

Browser pause/Continue can still freeze any phase, and touch controls are disabled
through death. Those are browser conveniences, not a DOS keyboard/IRQ emulator.

## Validation and scope

```sh
python3 tools/export_web_assets.py
python3 tools/trace_pickups_and_death.py  # optional unicorn for regeneration
node --test tests/test_pickups_death.mjs
```

The ignored `pickups_death_traces.json` holds **6,720 pickup-window cases** and
**192 complete death/reset traces** across all 24 maps. Death traces execute
original enemy pursuit/contact, item handlers, life/score routines, reset code,
and timing; only graphics, waits and sound hardware are stubbed. They compare
every wait's enemy state, shield/energy, flags, position/camera, momentum, boost,
head correction, scheduler counters, pickup phase, sounds and final result.
Other AI families retain their existing separate original-code oracles.

Additional regressions cover fatal contact before projectile updates, a life-saving
third treasure, once-only pickups and persistence, render-only fall cropping and
animation cadence. A full normal DOS-versus-web playthrough and the remaining
same-tick transition edge cases are still separate verification work. This does
not claim instruction-exact browser raster timing or undefined debug positions.
