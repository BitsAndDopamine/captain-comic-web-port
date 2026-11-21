# AGENTS.md — Captain Comic (1988) repo notes

## What this is
- Original 1988 DOS shareware release of *The Adventures of Captain Comic* (Episode I,
  "Planet of Death") by Michael A. Denio, plus docs and one Python script.
- **Not a git repo.** No package manager or build system. Export verification tests:
  `python3 -m unittest discover -s tests` (run the web exporter first).
  Door interaction regressions: `node --test tests/test_doors.mjs`.
  All browser-independent JS regressions: `node --test tests/*.mjs`.
- Layout: `game files/` = the 54 original game files (read-only reference data) ·
  `rendered/` = generated PNG previews · `web/` = the web port (vanilla JS ES modules,
  no build step; `web/assets/` is generated) · `tools/` = Python asset scripts ·
  `README.md` = full documentation (reverse-engineered file formats in §5 — read it
  before touching the scripts).

## Working rules
- **Never modify, rename, or delete anything in `game files/`.** The shareware license
  in `COMIC.DOC` forbids modifying the program/graphics/doc files, and `COMIC.EXE`
  references the names internally (lowercase, e.g. `forest0.pt`, while files on disk
  are uppercase — fine on DOS's case-insensitive filesystem, but matters if assets are
  ever served from a case-sensitive web server).
- The folder name contains a space — quote it in shell commands: `ls "game files"`.
- `rendered/` is 100% generated output. Safe to delete and regenerate at any time.

## Commands
- Regenerate all previews: `python3 tools/render_assets.py`
  (works from any cwd — paths derive from the script's `__file__`; reads `game files/`,
  writes `rendered/`). Needs Python 3 with `numpy` and `Pillow`.
- Sanity check after running: `ls rendered | wc -l` → **55**
  (8 tile sheets + 24 level strips + 8 level composites + 14 sprite sheets + 1 overview).
- Export web assets: `python3 tools/export_web_assets.py` → writes `web/assets/`
  (tile sheets + level JSON + RGBA sprite sheets + `areas.json` parsed from COMIC.EXE).
  `web/assets/` is 100% generated — safe to delete and re-export.
- Run the web port locally: `cd web && python3 -m http.server 8791` then open
  `http://localhost:8791/`. No npm/build step — plain ES modules over HTTP.
  In-game: left/right arrows = walk, Up arrow = jump, Space = fire, Alt + Door Key = use a door,
  Caps Lock = Wand teleport while grounded; F1/F2 = sound on/off (also via footer),
  connected strip edges transition automatically, `1/2/3` = debug strip selection,
  `[`/`]` = debug area selection, Backquote (`) = dev overlay toggle. `window.__game` / `window.__keys`
  are exposed for driving it from the browser console (dispatch real `KeyboardEvent`s
  so the keydown edge logic runs).
- Cancel gameplay key defaults on both keydown and keyup (`controls.js`): Alt's
  release can activate the Firefox/Linux menu bar and steal input after a door.
  Score/name menus retain native keyboard behavior; do not force focus every frame.
- View/input: `presentation.js` handles Fullscreen API (entire #game-shell) and
  labelled CSS expanded fallback, including a1.8s timeout for hung host APIs.
  `touch_controls.js` tracks each pointer separately; `gameplayInput` combines it
  with keyboard state without cross-source releases. Touch mode auto-enables for
  coarse/touch devices and has a manual footer toggle. Portrait keys below,
  landscape (height<=600) keys beside the canvas; bitmap remains320x200. Clear
  touch/capture/tap timers and edge keys on interrupts; menus/death/doors disable
  keys. Fullscreen exit/orientation change pauses active play. Mobile score dialog
  is reparented from #display to #game-shell to escape its size-query containment.
  See `docs/fullscreen_and_touch.md`; `__presentation` / `__touchControls` exposed.
- User UI style requirement: keep all added website controls/menus/forms visually
  close to the game: canonical EGA colors, square corners, gray HUD panels,
  black insets, white/dark stepped bevels and monospace text. Avoid rounded modern
  buttons, gradients and non-palette colors. Preserve large touch targets, clear
  pressed/disabled/focus states and responsive non-overlapping layouts.
- Pause/menu: Esc freezes the run; Continue/another key resumes, Q while paused
  quits to the startup notice (not score submission). Blur/hidden tabs auto-pause.
  `Game.paused` guards all simulation/transitions; menus freeze the startup too.
  Discard elapsed time and clear held/edge inputs on resume. Original pause graphic
  DS:bac4 (128x48 at40,64) is exported as PAUSE. High scores use SYS005 and
  `web/src/high_scores.js`; top10 strict-greater insertion, 12-character ASCII names,
  localStorage `captain-comic.high-scores.v1`, in-memory fallback. Practice grants/
  debug strip/area changes use a separate board; skipIntro alone does not. Game Over
  waits for acknowledgment, then name/table, then New game. No reload save/continue
  is claimed; the original pause code only waits or exits. See
  `docs/pause_and_scores.md`; `window.__menu` is exposed for checks.
- URL test setup: `?items=all&colas=5&shield=6&skipIntro=1`; see
  `docs/testing_urls.md` and `web/src/test_options.js`. Grants apply before strip
  initialization and on New game; no score/life awards or pickup flags are changed.
  `all` means five tools only. Explicit shield cancels startup refill; positive
  Cola capacity defaults to full weapon energy unless `weapon` is specified.

## Gotchas
- In this environment **PIL's `Image.resize()` crashes** (`SystemError: ... returned
  NULL without setting an exception`). The scripts upscale with `np.kron` instead —
  keep doing that; don't "simplify" it to `resize()`.
- Palette-mode PNG gotcha: build `P`-mode images with `Image.fromarray(index_array, 'P')`
  + `putpalette(...)`. Converting RGB→P first (`img.convert('P')`) **re-indexes the
  colors** and scrambles the palette — that bug already bit once in the web exporter.
- Palette verified: BIOS mode **0Dh is 200-line RGBI**, not 350-line six-bit RGB.
  Register output uses `(v&7)|((v&16)>>1)` into canonical RGBI (brown correction);
  bits3/5 alias. Steady gameplay/export colors already match the original. Do not
  repaint magenta Cave artwork or invent area palettes. `tools/video_palette.py`
  extracts the EXE blank/reveal routines into `palette.json`. `palette.js` caches
  five canvases each for SYS000/001/002; only indices2/10/12 change. Title has5
  reveal+14 hold ticks; story rejects keys for5 reveal ticks; ending has5+20.
  Other screen changes are hard page flips. Previous ending used the wrong
  350-line interpretation; now fixed. `tools/trace_video.py` (optional Unicorn)
  regenerates ignored video-call traces; see `docs/colors_and_transitions.md`.
- `SYS*.EGA` are decoded (PackBits-like RLE, see README §5) to `web/assets/sys/`.
  Player graphics are **embedded in the EXEPACK-decompressed EXE**, not missing:
  DS:75c0 / image 0x09d00 = ten original 16x32 frames. `export_exe_assets.py`
  exports them, death/teleport effects, item graphics and `world.json`; the normal
  web exporter calls it automatically. Screenshot tools are now historical only.
- Sprite format correction: `.SHP` and embedded sprites store **four color planes
  FIRST, then an inverted AND mask** (1=transparent, 0=opaque). Shared decoder:
  `tools/sprite_format.py`. Opaque black must not be made transparent.
- `KEYS.DEF` / `COMIC.HGH` are created by the game at runtime; they don't belong in
  `game files/`.
- Screen chrome: `SYS003.EGA` is the full in-game HUD screen — the web port draws it
  as the base image (gray bg + white frame + panel + bottom life strip) and blits the
  level into the playfield window x=7..202, y=7..168. Verified pixel-identical against
  `screenshot first level.png`. Dynamic HUD geometry (score digits, bars, life icons,
  inventory box) is measured into `web/assets/hud.json` by `export_hud_and_items()`.
- Tile solidity is derived from the unpacked EXE: collision routines at image offsets
  `0x0dba`/`0x0df4` compare the playfield tile ID with the first byte of the area's
  `.TT2` header (loaded at `DS:0x0c40`); IDs greater than that cutoff are solid.
  Per-area cutoffs live in `tools/solidity.json` and are validated against each file
  during export.
- Tile 0 is opaque artwork, never an empty/transparent cell. Lake/Shed use it for
  cyan sky, Base for gray panels, and Castle/COMP/Space for patterned backgrounds.
  Draw it through `web/src/tilemap.js`; skipping zero exposes the black canvas.
- Pixel-art rendering: round the camera once for all draw layers; do not round
  simulation coordinates or mutate the logical camera. `drawTilemap()` also snaps
  its camera defensively so adjacent atlas blits always have integer destinations.
  This avoids relying on browser-specific subpixel sampling at tile edges.
- EXE addresses must refer to the **unpacked** 100,208-byte image, never packed
  file−0x200. Use `unpack_exepack()` from `tools/export_audio.py`. Main DS base is
  image 0x2740; SYS loader is 0x0a52 (RLE 0x0a80); area loader is 0x0acc.
  The CASTLE blanking branch at 0x0b14 checks the **lantern flag** DS:004d:
  it is dark-area rendering, not anti-tamper protection.
- Original world records: image 0x0fdf0 + area*208, first 203 bytes used.
  24 pickups, 36 doors, 96 enemy behavior slots; **enemy positions are dynamic**.
  `web/src/enemies.js` now implements the original spawn scheduler and five AIs at
  DOS tick rate. `spawns.js` is historical/unused. Shared DS:d440/d441 persist across
  strips: respawn delays 20..100 by20; spawn offset initially22, first candidate24.
  High-bit behavior seeds phase2; preserve its cadence semantics. Original shot and
  contact windows use sprite units, not the provisional player AABB. See
  `docs/enemy_ai.md`; oracle tests cover 1,440 cases and 24×400 original-code ticks.
- Door records use sprite top-lefts, not the 12x15 web hitbox top-left. Use the
  coordinate conversion in `web/src/doors.js` for both interaction and arrival;
  a grounded player at the last Forest door has hitbox y=113, sprite y=96.
- Door animations use area-record `transitionTiles`, a 32x32 opening, and 8px
  shutter halves (EXE departure 0x1111, arrival 0x1094). `mechanics.json` holds
  tick sequences. The one reusable `key` unlocks all original doors (DS:004c);
  do not invent per-color key requirements. Movement/combat pause during animation.
- User requested deferring the key/door dispute: keep current door behavior useful
  for testing. If new door/key evidence appears while investigating other code,
  revisit it rather than treating the question as permanently closed.
- Score font: DS:b784 / image 0x0dec4, ten 8x16 glyphs, four color planes without
  mask. Exported as SCORE_DIGITS. `mechanics.json` records confirmed HUD geometry,
  100 displayed points per stored score unit, 50,000-point extra-life threshold,
  and original six-unit shield / twelve-unit weapon-energy caps. Score font/scaling
  and 300/2,000 point awards are wired. `web/src/lives.js` now implements four initial
  spare lives (cap five), six-unit shield/recharge, score/treasure/full-shield extras
  and explicit Game Over. Lit/unlit LIFE_ICONS and ENERGY_CELLS use opaque blits.
  FIREBALL_CAPACITY supplies original counts 1–5 and alternate states. See
  `docs/lives_and_hud.md`; never replace those state graphics with flat gray covers.
- Fireball resources are in `web/assets/sprites/FIREBALL.png`: 2 original 16x8 frames
  from DS:8240/8290. Original capacity (DS:48) and weapon energy (DS:49) start at 0;
  Cola raises capacity to 5, Corkscrew is DS:4b. Web firing uses the ~18.2 Hz DOS
  timer model, as do enemies. Enemy contact precedes projectile movement/hits.
- Player movement in `player.js` / `vertical_motion.js` uses the shared combat DOS
  clock: 8px steps, grounded turn-before-walk, signed air momentum, knee-height wall
  probes, Boots' boost (56px →72px), SPACE gravity and head/landing probes. Camera
  scrolls one 8px unit after successful steps outside its 10..12-unit dead zone;
  initialization clamps spriteX/8−11 to 0..232. Never recenter each frame. Research:
  `docs/player_physics.md`; `mechanics.json.playerPhysics` has both implementation
  flags true. The 12x15 box remains a legacy coordinate adapter, NOT pickup/terrain collision.
  Linked edges trigger on attempted movement beyond sprite X=0/254, preserve air
  momentum/facing/state, and reset vertical velocity. Oracle tests cover synthetic
  sequences plus 1,572 single-tick real-map states (all 36 door arrivals).
  Side probes are at spriteY+24, not a 16x32 AABB; ground/landing at +32/+40.
  Optional `tools/trace_*` oracle regeneration needs Unicorn; regular tests/export do not.
- Pickups/death: `entities.js` uses original sprite-unit |dx|<2, dy0..3 and camera
  offset0..22. `collectPickups()` runs at the end of DOS ticks, not at60Hz; shared
  DS:d490 bank changes only on eligible non-contact passes. Contact death immediately
  re-enters enemies + pickups for frame0, then seven more tick frames. Guarded
  contacts still request damage at zero shield; do not recursively kill or abort
  the enemy loop. No movement/projectiles/refill during explosion; later waits
  hide/freeze all actors. Fall Y17/18/19 crops to24/16/8 rows for1 tick, then blank2
  + death15; no-spares adds1 Game Over tick. Respawn preserves tools/score/energy/
  pickups/facing/head correction/shared schedulers, resets boost counter4 even with
  Boots (release rearms5), animation0, shield0+refill6 and weapon recharge2. Do not
  replace the strip-entry checkpoint on Wand. See `docs/pickups_and_death.md`;
  `trace_pickups_and_death.py` regenerates6,720 geometry cases +192 full death traces.
- Item abilities: `items.js` selects Wand targets (0x1298), six effect phases
  (0x1348), original WAND_SHIFT [0,1,2,1,0] frames, and Castle-only Lantern darkness.
  Wand pauses movement/firing but NOT combat or shield refill. It does not replace
  the death checkpoint. Darkness hides terrain/shutters only, never collision or
  sprites. See `docs/item_abilities.md`; oracle fixtures cover 2,016 targets and
  all area/Lantern combinations. Caps Lock is edge-triggered; Space fires.
- Startup: `startup.json` and `web/src/startup.js`: original notice, SYS000 title,
  SYS001 story, SYS004 legend, SYS003 planet/HUD, then 12-frame teleport arrival.
  SYS002 is the ending. Enter/Continue advances the key-wait pages; other stages
  are timed. The game is frozen during startup. Original spawn is sprite (112,96)
  / hitbox (114,113), FOREST strip 0, camera x=24 (follow offset 88 px).
- Victory: `victory.js` / `mechanics.json.victory`; third treasure arms counter20,
  triggers at1 after19 DOS ticks. Then 1+12+6 tick departure, 20x1,000 base bonus,
  10x1,000 per spare, consume one icon, wait3, repeat (score-earned extras remain
  active). Do NOT use loseLife for tally consumption or snapshot the initial lives.
  No world/combat/refill advances after departure starts. SYS002 has five local
  EGA palette steps then20 hold ticks; fresh key -> silent Game Over, second key
  -> final-score entry. `Game.runEnded` includes this victory Game Over without
  setting `life.gameOver`. Pause/focus loss freezes the sequence. All-three-treasure
  URL grants preview victory without pickup points/lives/flags, on the practice
  board. `tools/trace_victory.py` (optional Unicorn) regenerates 120 ignored oracle
  traces; see `docs/victory.md`. Score wrap carries into adjacent DS:0053, then
  increments it again; preserve this original extra-life-counter behavior.
- Action audio: `sounds.json.events` maps confirmed actions and original CL
  priorities (driver 0x086f). `GameAudio` unlocks from a user gesture and uses one
  channel; lower-priority requests are ignored, equal/higher ones replace it.
  `window.__audio` is exposed. Do not play cues in unguarded render loops or queue
  old shots before activation. Normal web export also regenerates WAVs.
  See `docs/action_sounds.md` for mappings and exact trigger timing.

## Verification
- After any change to `tools/render_assets.py`:
  `rm -rf rendered && python3 tools/render_assets.py`, then confirm 55 files exist and
  spot-check `rendered/level_FOREST_all.png` and `rendered/shp_BALL.png` visually.
- After any change to `tools/export_web_assets.py` or `web/src/*`: re-run the exporter,
  reload `http://localhost:8791/` in the browser, and confirm zero console errors and a
  correctly colored level (black canvas = stale tab or broken palette export).
