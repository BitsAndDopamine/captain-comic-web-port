# Action sounds and the original speaker channel

`tools/export_audio.py` now associates all 14 tables with confirmed callers and
their CL priority in the EXEPACK-decompressed image. WAV filenames/IDs are stable.
The normal web exporter also regenerates the audio manifest and WAVs.

| Action event | Cue | Priority | Original call image offset(s) |
|---|---|---:|---|
| `intro` | `intro_theme` | 4 | `0448`, `14e2` (also reused by the ending) |
| `door` | `sound_02` | 4 | `10d3`, `1144` |
| `contactDeath` | `sound_03` | 4 | `1252` |
| `teleportShift` | `sound_04` | 2 | `1346` |
| `victoryTally` | `sound_05` | 3 | `149a`, `14be` |
| `teleport` | `sound_06` | 4 | `1542`, `15ca` |
| `gameOver` | `sound_07` | 2 | `1435` |
| `stripChange` | `sound_08` | 4 | `1a91` |
| `death` | `sound_09` | 4 | `1860` |
| `fire` | `sound_10` | 0 | `2035` |
| `enemyHit` | `sound_11` | 1 | `212c` |
| `extraLife` | `sound_12` | 4 | `2139` |
| `damage` | `sound_13` | 2 | `2206` |
| `pickup` | `sound_14` | 3 | `2506` |

The INT 3 handler at `0x086f` ignores a new cue if its CL priority is **lower**
than the current cue's priority. Equal or greater priority replaces the current
sequence; there is no mixing and no queue. The browser's `SoundChannel` follows
that rule. For example, firing cannot interrupt a door/extra-life cue, but repeated
successful shots can restart the firing beep. A Game Over cue request can itself be
suppressed while the higher-priority life-loss sound is still active, as in the EXE.

## Gameplay integration

- A firing beep is requested only when a projectile slot is actually allocated,
  not merely when Space/Fire is held, energy is empty or all slots are occupied.
- Doors request a cue once at departure and once after the three-tick arrival wait.
  Connected left/right strip crossings request `stripChange`; debug selectors do
  not invent a second door or level sound.
- Pickups request their cue once on collection. A treasure/full-shield pickup or
  score milestone can then request the higher-priority extra-life cue, including
  an award converted to points at the spare-life cap.
- Shield hits request `damage`; an already-empty shield starts `contactDeath`.
  The shared life-loss cue starts after the explosion and two-tick wait (or after
  the optional one-tick fall crop plus two blank ticks for falling). Game Over
  requests its cue after its own one-tick wait, not each render frame. Guarded
  enemy contacts during the explosion can request `damage` even at zero shield;
  original single-channel priorities still decide which requests are audible.
- Startup uses the same player for the theme, stops it when leaving the legend,
  and requests `teleport` once when arrival-effect frames begin. The silent startup
  life-counter setup remains silent, matching the muted EXE initialization.
- Wand shift now requests `teleportShift` once when Caps Lock activates the owned
  Wand while grounded; its six-tick effect is distinct from startup arrival.
- Victory tally requests its cue for every original bonus increment; the ending
  reuses the theme. Its later Game Over panel intentionally has no Game Over cue.

## Browser behavior

Assets are fetched ahead of time; a real key/click creates/resumes Web Audio and
decodes the buffers. Before that gesture, action requests are discarded rather
than accumulating. During decoding, at most the latest highest-priority cue is
pending. Mute/restart invalidates pending requests and stops the current source.
Unavailable/blocked audio does not stop gameplay. Restart reuses the same audio
context; it does not leak a new context for each run.

F1 enables sound, F2 disables it; the footer Sound button toggles the same setting.
`window.__audio` exposes the controller for inspection. Unit tests cover event
mapping, priority replacement/rejection, expiry, stop/mute and life-system events.
