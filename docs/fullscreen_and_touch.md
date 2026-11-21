# Fullscreen and touch/mobile mode

## Using it

- **Fullscreen** expands the entire game shell: original screen, footer and touch
  keys. Use **Exit fullscreen** or the browser's Escape gesture to leave.
- If native fullscreen is unsupported, rejected, or never completes (some embedded
  browsers), the game switches to an explicitly labelled **expanded view** instead.
  This fills the available browser viewport but cannot hide browser/OS chrome.
  Tap **Exit expanded view** to leave. A request times out after 1.8 seconds rather
  than leaving its button permanently disabled.
- **Touch: on/off** enables or hides the large game keys. Touch mode starts on
  automatically for a coarse primary pointer or a device reporting touch points;
  it can also be enabled manually on desktop. This is a view setting for the
  current page, not a saved game or a change to high-score eligibility.
- Portrait layouts put keys below the game, anchored toward the bottom. Short
  landscape layouts put movement on the left and actions on the right. The game
  image is never covered by the keys or stretched out of its original 8:5 ratio.
- **← / →** walk, **Jump** is Up arrow, **Fire** is Space, **Door** is Alt, and
  **Wand** is Caps Lock. Item requirements and original jump/weapon timing remain
  unchanged. Pause and Continue remain large footer buttons.

Hold movement/Jump/Fire as with the physical keyboard. Multiple fingers can hold
move + jump + fire together. Door/Wand act once per new press. Pointer capture
keeps a held key active if a finger drifts outside it, and releasing/cancelling
that pointer releases only its own input. Keyboard and touch can be mixed.

Pause, menus, death/door transitions and completed runs disable the game keys.
Hiding the controls, view changes, orientation changes, focus loss and interruption
clear held/queued inputs. Leaving fullscreen/expanded view or rotating the device
pauses active play; Continue resumes without replaying held touches. Normal
browser zoom remains available outside the key panel; long-press selection and
scroll gestures are suppressed on the game keys only.

Name entry/high scores use a readable viewport-sized mobile dialog, 16px input
text and 44px-or-larger form controls instead of tiny canvas-scaled fields. The
dialog is reparented outside the canvas's CSS size container in touch mode, then
restored for desktop. Visual viewport resizing keeps the dialog scrollable when
the device keyboard takes space. No mobile OS keyboard/permissions are emulated.

## Implementation

- `web/src/presentation.js`: native/prefixed Fullscreen API, bounded asynchronous
  requests, honest expanded fallback, coarse-pointer default and viewport fitting.
- `web/src/touch_controls.js`: per-pointer held state, cancellation/capture loss,
  pressed styling, disabled-state cleanup and keyboard/assistive click activation.
- `web/src/controls.js`: combines touch and physical keyboard without one source
  releasing another. Main's existing edge flags still queue jump/door/Wand actions.
- `web/presentation.css`: responsive controls, safe-area padding, focus outlines,
  portrait/landscape placement and the mobile score dialog. All added UI follows
  the game's EGA palette, square corners, gray HUD chrome and white/black bevels;
  Jump/Fire and Door/Wand accents use game colors, not modern rounded/pastel keys.
  Mobile hints are shortened so the larger controls do not crowd the game image.
  Startup text stays in a centered 80-column block and scales with the display
  (`#startup-text` / `#startup-copy` in `web/index.html`). Do not add a minimum
  font size or touch-only wrapping: those break the original spacing on phones.
  The original notice is `notice` in generated `web/assets/startup.json`, extracted
  by `tools/export_exe_assets.py`; direct JSON edits are overwritten on export.

The bitmap stays **320×200**, with `image-rendering: pixelated`. This only changes
CSS presentation; camera snapping, world coordinates, palettes and DOS-tick
simulation are unchanged. `window.__presentation` and `window.__touchControls`
are exposed for browser verification; `window.__keys` still means physical keys.

## Verification

`node --test tests/test_controls.mjs tests/test_presentation.mjs` covers mixed input,
multiple fingers on one key, capture failure, cancellation, disabled menus, screen
fit and native/prefixed/rejected/hung fullscreen operations. Browser checks cover
simultaneous movement/jump/fire, keyboard isolation, pause cleanup, 320×568 and
390×844 portrait, 844×390 landscape, and viewport-sized mobile name entry. Native
fullscreen depends on the host browser; the embedded Review browser exercised the
timed expanded-view fallback. Physical iOS/Android device testing remains useful.
