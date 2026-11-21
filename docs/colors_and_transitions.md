# Original colors and screen transitions

## The important mode distinction

COMIC.EXE selects **BIOS video mode 0Dh: 320×200, sixteen colors** at image
`0x042a`. This is 200-line **RGBI-compatible** output, not the independent six-bit
RGB color mapping of EGA's 350-line mode 10h.

For mode 0Dh, a palette register selects color with bits 0–2 and common intensity
with bit 4. Bits 3 and 5 alias existing colors. Non-intense yellow is brown. Thus:

| Register | Correct 200-line RGB | Not the 350-line interpretation |
|---|---|---|
| `0x18` | `(85,85,85)` dark gray | `(0,85,85)` |
| `0x1a` | `(85,255,85)` light green | `(0,255,85)` |
| `0x1c` | `(255,85,85)` light red | `(170,85,85)` |
| `0x1f` | `(255,255,255)` white | `(170,255,255)` |

The BIOS's initial attribute-register values are 0–7 and 16–23. The game changes
indices 2,10,12 to registers 2,26,28; **the resulting steady colors are still the
canonical sixteen RGBI colors**. The previous assertion that all gameplay assets
used an approximate/missing custom palette was misleading. Cave artwork encoded
with magenta remains magenta; there is no evidence for an invented area palette.

This also corrects the previous ending implementation, which interpreted the
right register writes using the wrong (350-line) output mapping. No gameplay art
needs repainting or recoloring. Tile zero, opaque sprite black and original masks
are unchanged. This models the digital palette, not analog CRT phosphor/gamma.

Hardware cross-check: DOSBox Staging's
[`src/ints/int10_modes.cpp`](https://github.com/dosbox-staging/dosbox-staging/blob/main/src/ints/int10_modes.cpp)
assigns `palette.cga64` to modes below 0Fh and the independent `palette.ega` to
mode 10h. Its mode-0Dh attribute setup uses 0–7/16–23. These are hardware facts;
no emulator source or BIOS ROM assets are bundled in this project.

## Original palette reveal

`0x052a` blanks only indices **2,10,12**, not the whole screen. `0x0543` then
changes those entries in five one-tick steps (~18.2065 Hz):

| Step | Register values for indices 2 / 10 / 12 | Visible colors |
|---|---|---|
| 0 | 24 / 24 / 24 | dark gray / dark gray / dark gray |
| 1 | 7 / 7 / 7 | light gray / light gray / light gray |
| 2 | 7 / 31 / 31 | light gray / white / white |
| 3 | 2 / 26 / 31 | green / light green / white |
| 4 | 2 / 26 / 28 | green / light green / light red |

This is a stepped palette reveal, **not** a smooth crossfade, brightness filter,
or a fade applied to every color. Other pixels retain their original colors.
The blanking and first reveal writes occur together with the page flip without a
separate timed all-black frame.

The same routine is called on **SYS000 title**, **SYS001 story**, and **SYS002
ending**. Title lasts five reveal ticks plus fourteen hold ticks. Story rejects
input during its five reveal ticks, then waits for a fresh key. Ending has the
same five steps plus twenty hold ticks before its key wait.

## Other transitions

`0x0fbd` selects a preloaded video page and synchronizes to vertical retrace; it
does not blend, wipe or fade. In the browser these changes are atomic frame
changes. No artificial fades have been added to:

- story → legend → planet/HUD;
- linked strip/area changes;
- pause/Game Over panels;
- high scores (the original sets mode 0Dh again and loads SYS005 directly).

The existing area-record door shutters, teleport effects and death effects stay
separate from palette changes. Their gameplay rules were not changed by this
palette work. Exact CRT raster/retrace timing is not emulated at sub-frame level.

## Implementation and checks

- `tools/video_palette.py` reads the original MOV/INT10/wait instructions and
  rejects unexpected code. `palette.json` records colors, all 64 register aliases,
  initial/gameplay register values, original writes and reveal steps.
- Both exporters share this verified steady palette. All six SYS PNGs, sprites,
  HUD and tiles retain their original palette indices/masks and canonical colors.
- `web/src/palette.js` caches fifteen native-resolution canvases at load time:
  five steps for each of the three affected screens. Title/story and victory use
  the same implementation and source data. No per-frame canvas readback, color
  filtering, resampling or extra camera rounding is introduced.
- `startup.js` owns palette timing and the story input gate. Opening high scores
  during startup freezes its reveal and resumes it unchanged. Continue is disabled
  until ready.
- Original DOS notice text uses color 7; score-entry prompts use 9/10 and scores
  use 12. Browser text remains accessible DOM text, not an emulated BIOS font.

Regenerate assets with `python3 tools/export_web_assets.py`. Optional
`python3 tools/trace_video.py` (Unicorn) writes ignored `video_traces.json`.
Its original-code trace records title at tick 0, story at 19, both BIOS key waits
at 24, legend/planet page flips at 24, then area loading at 32 (assuming immediate
key responses). It also verifies the high-score mode reset without a fade.
Palette writes are independently covered by the existing victory-code oracle.

Tests: `tests/test_palette.mjs`, `tests/test_startup.mjs`, `tests/test_victory.mjs`,
and `tests/test_exe_assets.py`. Full-playthrough verification remains separate.
