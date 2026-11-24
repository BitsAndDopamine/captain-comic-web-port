# Original and 30 FPS animation modes

The footer button switches between **Animation: Original** and **Animation: 30 FPS**.
Original is the default on a fresh browser profile. The selected mode is stored
locally as `captain-comic.animation.v1`; blocked storage falls back to this tab.
Invalid saved values fall back to Original. The setting is not a gameplay grant
and does not turn a run into a practice run.

## Original

Renders the actual simulation positions and original sprite frames with no motion
interpolation. Movement/combat animations remain on their original ~18.2 Hz DOS
ticks; timed startup/door sequences retain their existing clocks. The browser may
repaint the same image more often, but the original tick-based look is preserved.

## 30 FPS

The **entire canvas presentation** is drawn at up to 30 FPS: startup, gameplay,
HUD, doors, tools, death, victory and ending. Player/enemy/projectile movement and
camera scrolling interpolate between original tick positions, then round to
integer pixels. All terrain and sprite layers share one interpolated camera;
the existing map-edge clamp still applies.

This does **not** run the simulation at 30 ticks per second:

- Movement speed, jumps, input sampling, enemy AI/spawning and collision stay the same.
- Fireball motion, hits, lifetime, energy/shield recharge and scoring stay the same.
- Animation-frame sequences, pickup banks, doors, effects, palettes, tally timers
  and audio keep their original durations/cadence. Existing artwork does not gain
  invented in-between frames. Stationary frame animations still use original frames,
  now presented as part of the 30 FPS canvas. There are no new fades or color blends.
- Pause, startup input gates, death waits and victory do not advance faster.
- Gamepad polling and keyboard/touch input are not throttled to the drawing rate.

As with fixed-tick interpolation, displayed movement can trail the collision state
by up to one original tick (about 55ms). This is visual only and opt-in. Original
mode restores exact tick positions immediately.

Level/door changes, respawns, large teleports and phase changes snap cleanly rather
than sliding across the map. Spawned enemies do not interpolate from inactive slot
coordinates, and killed enemies or consumed projectiles do not linger as ghosts.
Pausing freezes the interpolated pose. Switching modes resets the visual history,
not the game or its clocks; New game retains the selected visual mode.

## Implementation and verification

- `web/src/animation.js`: validated preference, 30 FPS draw pacing, read-only
  per-tick position snapshots and render-only poses.
- `web/src/main.js`: records snapshots at existing DOS ticks, samples poses for
  rendering, and gates the whole canvas draw without changing simulation steps.
- `window.__animationMode` exposes mode/pacing; `window.__game.visuals` exposes
  visual history. The actual player/enemy/fireball objects remain authoritative.

```sh
node --test tests/test_animation.mjs
```

Tests cover default/persistent/fallback preferences, pacing on 60/90/120/144Hz
displays, all moving actor layers and camera, pause/mode changes, spawn/transition
resets, integer destinations, original drawing, 1,200 identical gameplay updates,
and matching door/victory sequences in both modes. Browser checks additionally
measure render versus simulation rates and portrait/landscape footer layouts.
