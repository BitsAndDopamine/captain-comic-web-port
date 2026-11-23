# Keyboard definitions and USB controllers

At the initial notice, press **K** for **Keyboard definition** or **J** for
**Joystick / USB controller**. Matching footer buttons work with mouse/touch too.
These are browser configuration menus, not emulation of DOS keyboard interrupts,
`KEYS.DEF` or the original joystick-port calibration routines. The original notice
and game files remain unchanged.

## Keyboard

Select an action, then press its replacement key. Changes apply immediately and
are saved automatically; **Back to startup** returns without starting the game.
**Esc** cancels a pending assignment, or returns when not assigning. Tab/Shift+Tab
and Enter navigate the menu. **Restore defaults** restores:

| Action | Default |
|---|---|
| Move left/right | Left/right arrows |
| Jump | Up arrow |
| Fire | Space |
| Door | Alt (either side) |
| Wand teleport | Caps Lock |

Each action has one physical-key assignment (`KeyboardEvent.code`). Key labels
refer to physical codes, so letters can differ on non-QWERTY layouts. Both Alt
keys are treated as the same assignment. Duplicates are rejected, not silently
swapped. Keyboard mappings do not change the on-screen touch keys.

Esc, Tab, Enter, F1/F2, Ctrl/Command and the debug navigation keys are reserved.
Ctrl/Command browser shortcuts remain native outside key capture. A different
combination can avoid a keyboard's rollover limits, but JavaScript cannot recover
keypresses the keyboard hardware never reports.

## Controllers

Uses the browser **Gamepad API**, including USB and Bluetooth controllers that the
OS/browser exposes. Use HTTPS or localhost; browser permissions, privacy settings
and embedding policy may block access. Connect the controller, focus the page,
press a button, then release it. No browser detection does not necessarily mean
the controller is unsupported by the OS.

The menu shows connected devices, a device selector, an enable checkbox, horizontal
stick-axis selection, current input and action-button assignments. Automatic mode
uses the first connected device; explicitly selected devices are not silently
replaced if disconnected. Non-standard mappings are labelled and can be adjusted.
The left/right D-pad buttons use standard Gamepad indices 14/15; on non-standard
devices use the appropriate horizontal axis if the D-pad differs.

Standard defaults:

| Action | Gamepad API button | Common label |
|---|---|---|
| Jump / confirm | 0 | A / Cross |
| Fire | 2 | X / Square |
| Door | 1 | B / Circle |
| Wand | 3 | Y / Triangle |
| Pause / resume / confirm startup | 9 | Start / Options |

The menu displays button numbers **one-based** (API button 0 is “Button 1”).
Select an action, release buttons/center the stick, then press its replacement.
Duplicate assignments and the left/right D-pad buttons are rejected. Button 0
and button 2's common labels are explanatory for standard-mapped controllers;
non-standard device labels/layouts can differ.

The selected jump action confirms startup/ending/Game Over and resumes pause.
The selected fire action also closes the high-score table. Name entry still uses
the normal text field. The Pause button also returns from the J setup menu when
not assigning a button. Controller input supplements, rather than replaces,
keyboard and touch. Browser audio may still require a keyboard/click/tap gesture.

## Persistence and safety

- LocalStorage keys: `captain-comic.keyboard.v1` and `captain-comic.gamepad.v1`.
  The selected device index is session-only because browser indices are not stable.
- Corrupt settings fall back to complete defaults. If storage is blocked, changes
  work for the current tab and the menu reports that they could not be saved.
- Setup freezes startup/gameplay. Menus trap focus and make the underlying game
  inert; their viewport-level EGA panels scroll on small screens.
- Focus loss, pause, setup entry/exit and controller reconnect clear input. Buttons
  must be released and the stick centered before controller input rearms.
- Disconnecting an active controller clears its state and pauses an active run.
  Keyboard/touch holds are never released just because a controller button is.
- Sticks use a 0.3 movement threshold and require a neutral value below 0.2 to rearm.
  Buttons activate above 0.5 or when the browser reports `pressed`.

## Implementation and tests

`controls.js` validates/persists keyboard mappings and merges logical actions;
`gamepad.js` polls devices, filters edges and handles neutral/disconnect safety;
`input_setup.js` implements the menus. `main.js` queues controller edges between
browser frames, feeds the existing DOS clock and preserves the startup/menu gates.

Run `node --test tests/test_input_settings.mjs tests/test_controls.mjs tests/test_startup.mjs`.
Regressions cover remapping, conflicts, reserved keys, corrupt/blocked storage,
three-action input, mixed sources, stick/D-pad/button thresholds, device selection,
neutral/reconnect handling and controller settings. Browser checks use synthetic
Gamepad samples and test the menu-to-gameplay path; real USB/Bluetooth hardware
still needs hands-on testing in each target browser/OS.
