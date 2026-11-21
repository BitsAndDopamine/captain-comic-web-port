# Pause, Continue and high scores

## Browser controls

- **Esc** or **Pause** freezes the current run, including enemies, projectiles,
  recharge, pickups, door/death/Wand effects and gameplay animation.
- **Continue**, Esc again, or another gameplay key resumes the same run. The
  resume key does not also move/fire. Held inputs are cleared; press again to act.
  Tab still navigates buttons; F1/F2 still control sound.
- **Q** while paused, or **Quit to title**, abandons the run and returns to the
  opening notice. Quitting does not submit a score. A browser cannot exit to DOS.
- Losing window focus or hiding the tab also pauses active gameplay. Returning
  does not resume automatically. Continue discards elapsed time, not fast-forwards.
- **High scores** opens the table without ending a run; Back returns to exactly
  the prior state (including remaining paused or on an intro page).

Continue means **resume a run still open in this tab**. Reloading/closing the page
does not save a game. Although COMIC.DOC's feature banner advertises “Save /
Continue”, the inspected pause path only waits for a key or exits. No gameplay
save/load path has been identified in this executable; don't infer one from that
banner or confuse saved keyboard definitions with saved progression.

## Scores

After Game Over, press a key or click High scores. A qualifying score requests a
name, then displays the top ten. New game restarts with the current URL test setup.
Victory now runs its original departure/tally and ending screen before returning
to Game Over for this same score-entry flow. The fully tallied score is submitted;
see [Victory sequence](victory.md).

- Ten entries, descending; insertion is **strictly greater**, so equal scores
  follow existing ties. Zero never qualifies against the original blank zero rows.
- Displayed scores are eight digits, with the original two trailing zeroes.
- Names accept at most twelve printable ASCII characters (the DOS 0Ah maximum
  of thirteen includes CR). Control/non-ASCII characters and `$` are removed.
  Browser rendering uses text nodes, never HTML from names/storage.
- JSON is stored under `captain-comic.high-scores.v1` in this origin's localStorage.
  Different hosts/ports/profiles have different tables. No network service is used.
- Invalid data is ignored/sanitized. Blocked storage or quota errors fall back to
  the in-memory table with a visible warning, without interrupting play.
- Inventory/energy/shield URL grants and debug area/strip changes make the run
  **practice**. Practice scores have their own table. `skipIntro=1` alone and the
  debug overlay do not classify a run as practice. Both tables can be viewed.
- Submission is once per finished run. Opening/closing the table or repeating
  Enter cannot submit the same run twice. No original COMIC.HGH is bundled/imported.

## Original-code evidence

All addresses refer to the unpacked 100,208-byte image.

- `0x13cb..0x1409`: pause draws four opaque planes from DS:bac4, 128×48, at
  screen (40,64); BIOS key wait accepts lowercase/uppercase Q (`0x71`/`0x51`)
  to jump to process exit `0x05dc`. Any other key returns to the running game.
  Exported as `PAUSE.png`, not a newly drawn replacement.
- `0x140a..0x144b`: Game Over waits for a key, calls the high-score routine, exits.
- `0x2580`: loads SYS005, the original “Famous Comics” high-score background.
- `0x25b7`: opens COMIC.HGH and reads 180 bytes. Missing files initialize ten
  blank records from DS:d69d. Each record is eighteen bytes: fourteen name bytes
  (including `$` terminator), three little-endian base-100 score bytes, padding.
- `0x25d3..0x25fc`: scans ten scores, comparing most-significant score group
  first; only a strict improvement inserts before the current entry.
- `0x261b..0x2663`: copies the score and reads the name into DS:d64d's DOS 0Ah
  buffer (first byte `0x0d`). `0x268c..0x26a8` rewrites COMIC.HGH.
- `0x26aa..0x2709`: prints ten names/scores and the `00` suffix, then waits.

The web uses original pause/SYS005 artwork but accessible browser text/form
controls for names and scores, not an extracted BIOS font. Regression tests:
`tests/test_pause.mjs`, `tests/test_high_scores.mjs`. `window.__menu` exposes the
menu state for browser verification; it does not replace the active `__game`.
