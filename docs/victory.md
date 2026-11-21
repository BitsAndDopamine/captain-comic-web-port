# Treasure recovery and victory

Implemented in `web/src/victory.js`, driven by `mechanics.json.victory` and the
same ~18.2065 Hz clock as gameplay. Original files remain untouched.

## Trigger and sequence

Collect all three treasures: **gems, crown, gold**. The last pickup retains its
normal 2,000 points and extra-life award before scheduling victory. The game does
not immediately freeze: the original sets DS:d3fd to 20 and decrements it at the
start of subsequent gameplay ticks. Reaching 1, on the nineteenth tick, begins
departure before movement/combat/refill for that tick. Doors/death animations
defer this countdown; losing the last attempt before departure can still lose.

The victory routine then runs:

1. **Teleport out:** play the original teleport cue, show the player for one tick,
   then all twelve TELEPORT frames at one tick each. The player is present under
   the first six frames only. Clear the playfield back to terrain for six ticks.
   Pickups, enemies and projectiles are not drawn or advanced during departure.
2. **Base bonus:** twenty 1,000-point increments, one per tick, using the original
   victory-tally cue for each increment: **20,000 points**.
3. **Spare-life bonus:** while any spares remain, award ten 1,000-point increments,
   consume one spare, wait three ticks, and check again: **10,000 per spare**.
   Ordinary score-earned extra lives and the capped-life 22,500-point replacement
   still apply, so the loop is not computed from a snapshot of the initial lives.
   Consuming a spare here changes only its counter/icon, not shield/refill or
   Game Over state. Enemies, movement, weapon energy and shield refill stay frozen.
4. **Ending:** start the original theme and display **SYS002**, the original
   treasure-recovery / Episode II screen. Reproduce its five EGA palette steps,
   then wait twenty ticks before accepting a fresh key or Continue.
5. **Final Game Over:** that key returns to the last terrain/HUD with the original
   Game Over panel, no player/entities and **no Game Over sound**. A second key or
   High scores enters name entry/table using the final, fully tallied score.
   New game resets the run and reapplies URL options, as before.

Existing browser pause/Continue, focus-loss pause and score-table viewing work
during timed victory stages too. They freeze the sequence without re-awarding
bonuses on resume. Held/repeated gameplay keys cannot dismiss the ending.

Title, story and ending now share the verified **200-line RGBI** palette-reveal
implementation. This corrects the earlier ending's use of the 350-line RGB mapping;
see [Colors and transitions](colors_and_transitions.md). Steady gameplay colors
were already canonical RGBI. Full-playthrough comparison remains separate.

## Testing preview

```text
http://localhost:8791/?items=gems,crown,gold&skipIntro=1
```

Existing explicit treasure grants now arm the same countdown. They do **not**
award pickup points/lives or mark any map pickup collected. The run is practice,
and any submitted score stays on the practice table. Granting only one/two
treasures does not start victory; collecting the missing ones does. `items=all`
still means tools only and does not trigger the ending. New game with all three
treasure grants intentionally previews the ending again.

## Original-code evidence

All addresses refer to the unpacked executable image, not packed-file offsets.

- Treasure handlers `0x2431`, `0x244f`, `0x2473` call the life award and increment
  DS:004f; at three, `0x246d` writes countdown 20 to DS:d3fd.
- `0x1652..0x1664` decrements the countdown and branches at 1 to `0x1489`.
- `0x1538..0x159c` is the departure animation: 1 + 12 + 6 timer ticks.
- `0x148c..0x14a7` gives twenty `AL=10` score calls; each stored unit represents
  100 displayed points. `0x14a9..0x14d6` gives ten increments per spare and calls
  `0x2172` to consume it, then waits three ticks.
- The same score routine `0x2343` and extra-life routine `0x212f` execute during
  tally. Tests also caught an eight-digit score-wrap detail: the carry loop runs
  into adjacent DS:0053 before incrementing its extra-life counter again. The web
  score implementation now preserves that behavior, including clearing (rather
  than subtracting five from) the counter when awarding a life.
- `0x14d8..0x1512` starts the theme, loads `sys002.ega` via DS:d2de, calls palette
  routines `0x052a`/`0x0543`, waits twenty ticks, then reads a BIOS key.
- Palette indices 2,10,12 pass through effective register values
  `[24,24,24]`, `[7,7,7]`, `[7,31,31]`, `[2,26,31]`, `[2,26,28]`, one tick each.
  Source PNG pixels are remapped once to cached canvases, not filtered each frame.
- `0x1514..0x1535` draws terrain and Game Over, then jumps to the second key wait
  at `0x1436`, bypassing the Game Over cue. High scores follow at `0x2580`.

## Reproducible validation

```sh
python3 tools/export_web_assets.py
python3 tools/trace_victory.py   # optional Python unicorn required to regenerate
node --test tests/test_victory.mjs
```

The ignored `tests/fixtures/victory_traces.json` contains **120 original-code
traces**: 0–5 spares, all five score-carry phases, ordinary scores, threshold
crossings and eight-digit wrap. Only hardware I/O, rendering and waits are stubbed;
original tally loops, score arithmetic, extra-life recursion, spare consumption,
sound calls and palette writes run unchanged. Tests compare every wait's score,
spares, carry, shield/refill, sound order/timing, palette writes and final state.
Other regressions cover the countdown, all effect frames, early input rejection,
pickup/URL setup, pause/frozen simulation, final-score handoff and once-only entry.
