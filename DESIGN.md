# MMFF-App: design system

Approved direction: "Mirror + Dial", neon on black.

## Empty state is blank
With nothing linked, numerals show an em dash when unknown and 0.00 only when
the real value is zero. The dial draws empty outline rings with no text,
charts show axes with no line, tables say "Nothing here yet", budget bars are
empty tracks. Never fill a screen with example figures.

## Palette
| Role | Value | Use |
| --- | --- | --- |
| Background | `#0A0A0B` | page |
| Panel | `#111113`, `#121214` | cards and charts |
| Rule | `#2A2A2E` | dividers, borders |
| Text | `#F5F5F5` | primary |
| Muted | `#A1A1A8` | labels, secondary |
| Income | `#39FF88` | income and anything positive, with a green glow |
| Spending | `#FF2D55` | spending, over-budget, errors, with a red glow |

Glow is `text-shadow` or `box-shadow` at about 0.45 to 0.65 alpha. Use it on
large numerals, the dial rings, bars and the key alert only; never on body
text, where it blurs. Check every text pair for 4.5:1 contrast (3:1 for large
numerals) before shipping.

## Type
- Display and numerals: Big Shoulders (the Google Fonts family that replaced Big Shoulders Display), 700 and 900 (OFL).
- Body and UI: Barlow, 400 to 600 (OFL).
- Tabular, lining numerals everywhere:
  `font-variant-numeric: tabular-nums lining-nums`.
- Hero numerals use `clamp(72px, 11vw, 168px)`, `white-space: nowrap`.
  Compact notation above seven figures, with the full value in a tooltip and a
  screen-reader label.

## Layout rules
- Overview: a split hero, income on a green-tinted left half and spending on a
  red-tinted right half, with the dial straddling the seam. Net worth, latest
  transactions and the needs-attention card sit below.
- Top bar: logo, tab navigation (Overview, Budget, Transactions, Net worth,
  My Institutions), sync status. Tabs scroll sideways on a phone.
- 4px spacing base. Radius is small (0 to 6px) on panels; pills only for
  badges, tabs counts and the key callout.
- Touch targets are at least 44px.

## State rules
- Never color alone: every state carries a word, a glyph (`!`, `✓`, `▲`) and a
  sign (`+`, `−` using U+2212).
- Overspent: red, `!`, "over". On track: green, `✓`, "left" or "kept".
- Stale data keeps its numbers and gains a "last synced" label.
- Needs reconnect: one alert naming the institution with a single Reconnect
  button; affected figures are marked "as of <date>".
- Charts get a one-sentence visible or `<title>` summary and a text
  alternative.

## Motion
One orchestrated moment on load (the hero count-up and the ring draw), once
only. `prefers-reduced-motion` renders everything in its final state.

## Voice
Plain fact first, one dry line second. Examples: "Over by $412 with 17 days
left. Bold strategy." / "Locked out. Fix it before the numbers lie."
