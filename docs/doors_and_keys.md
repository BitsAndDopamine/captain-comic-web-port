# Door Key re-check against the original DOS files

Scope: **Captain Comic I, the DOS shareware files included in this repository**.
This finding is not a claim about every release, sequel or other adaptation.

## Result

This executable has **one reusable Door Key**, not different keys for different
doors. No gameplay change was made to invent key colors or door-specific locks.

Independent evidence:

- `game files/COMIC.DOC`, lines 181–186: Alt works when Comic possesses “the DOOR
  KEY”; lines 246–247 say it opens doors in various places on Tambi.
- The 24 original pickup records contain exactly **one** key pickup: Forest
  strip 2, sprite top-left `(1280,16)`, item ID 1.
- Its handler at unpacked image `0x23e1` sets the single byte `DS:004c` to 1.
- The complete door-selection loop (`0x16c3..0x16f4`) checks the open-door control,
  player Y, a three-unit horizontal window, then **only** `DS:004c == 1`.
  It does not compare any key type, color, area flag or other inventory item.
- Door entries are four bytes: Y, X, destination area, destination strip. The last
  two bytes are transition targets, not key requirements.
- The transition routine (`0x1a95..0x1abf`) selects that destination without
  consuming the key. Different-looking doors use area-specific graphics, not a
  separate key-matching rule in this version.

## The Forest walkthrough's “SECOND door”

`COMIC.DOC` lines 322–326 recommend the door to the **right** of the one
directly below the key ledge. The original Forest strip 2 records identify them:

| Door | Sprite top-left | Destination |
|---|---|---|
| Directly below the key ledge | `(1280,112)` | COMP strip 2 |
| To its right, the recommended exit | `(1904,96)` | LAKE strip 0 |

The key itself is at `(1280,16)`. Both door entries pass the original possession
check with the same key flag, and both transitions preserve it (covered by the
executable-backed fixtures). The walkthrough chooses a **destination/route**; it
does not state that the door under the ledge needs a different key. The Castle
door back in Forest strip 0 also uses that same possession check.

## Executable-backed regression checks

`tools/trace_doors.py` runs the actual 8086 selection instructions for every door:

- **2,016 cases** cover all 36 entries, all three valid horizontal positions,
  positions just outside either edge, incorrect heights, key absent/present,
  control released/pressed and other item flags cleared/set.
- All **36 transition paths** select their recorded destination and retain the
  key. Departure rendering is bypassed; execution stops at the destination loader.
- Committed `tests/fixtures/door_traces.json` includes the unpacked image SHA-256.
  Node tests compare web decisions to those original-code results. Python tests
  check provenance, the single pickup and the actual flag-check/set instructions.

Regeneration needs optional Python `unicorn`; normal tests do not:

```sh
python3 tools/trace_doors.py
node --test tests/test_doors.mjs
python3 -m unittest discover -s tests
```
