# URL options for testing

Append options after `?`, separating them with `&`. Example:

```text
http://localhost:8791/?items=boots,wand,lantern&colas=5&skipIntro=1
```

This gives Boots, Wand and Lantern, five fireball slots, full weapon energy,
and starts directly in the Forest. Up jumps, Space fires; Caps Lock uses the Wand while grounded.

| Parameter | Accepted values | Effect |
|---|---|---|
| `items` | Comma-separated item names | Adds the listed inventory items |
| `colas` | Integer 0–5 | Sets simultaneous fireball capacity; positive values also start with full weapon energy |
| `weapon` | Integer 0–12 | Sets starting weapon energy, overriding the Cola default |
| `shield` | Integer 0–6 | Sets starting shield; cancels the initial recharge so the override is not immediately replaced |
| `skipIntro` | `1` or `true` | Skips notice, title, story, legend and arrival animation |

Supported `items` names:

- Tools: `key`, `boots`, `wand`, `lantern`, `corkscrew`.
- Treasures: `gems`, `crown`, `gold`.
- `all` is shorthand for **all five tools**, not treasures or consumables.
- `cola` is shorthand for `colas=1`; `shield` grants full shield. Explicit numeric
  parameters override these shorthands. Use `colas=5` for maximum fireball capacity.

Item names ignore case and surrounding whitespace. Repeating `items` combines
the lists, without duplicates. Unknown items/parameters and malformed numeric
values are ignored. Valid safe integers outside the ranges are clamped to the
original caps; omitted values retain normal gameplay defaults.

## Examples

All tools, ready to fire, full shield, no intro:

```text
http://localhost:8791/?items=all&colas=5&shield=6&skipIntro=1
```

Only the Door Key, with normal startup:

```text
http://localhost:8791/?items=key
```

Test recharging an empty weapon with two fireball slots:

```text
http://localhost:8791/?colas=2&weapon=0&skipIntro=1
```

## Lifetime and limitations

- Options are applied at initial run creation and again on **New game**. Remove
  the query string and reload to return to normal starting inventory/settings.
- These are initial values, not invincibility or frozen counters: energy can
  recharge and shield can be damaged during play.
- Granted items do not award points/extra lives or mark map pickups collected.
  Original pickups remain available. Granting all three treasures now arms the
  victory countdown as a practice preview, without granting pickup points/lives.
  Try `?items=gems,crown,gold&skipIntro=1`; see [Victory sequence](victory.md).
- Any inventory/energy/shield grants classify the run for the separate **practice**
  high-score table. `skipIntro=1` alone still uses the normal table. Debug strip/area
  selection also marks the current run as practice.
- No URL option changes door rules, player position, area or strip.
- Skipping the intro does not bypass browser audio rules: sound still needs a
  keyboard/click gesture to activate.
- Inspect the normalized setup through `window.__testOptions` in the console.
  Implementation: `web/src/test_options.js`; no query string is executed as code.
