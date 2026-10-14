# MMFF-App: product context

Platform: web (Next.js on Vercel, Neon Postgres, Plaid for bank data).

## Users
One person, the owner, who opens the app for a fast read on where the month
stands. They are not a finance professional. They usually arrive on a phone or
laptop, glance for under a minute, and are sometimes anxious after a card
statement.

## Purpose
A personal net worth and spending tracker. It pulls bank, credit card and
brokerage data through Plaid into one daily net worth series and a searchable
spending history. Success is knowing in a few seconds whether the month is on
track, without opening a spreadsheet.

## Brand personality
Blunt, irreverent, honest. The name is the voice: the app states the number
straight and adds one short, dry line. It never sells, never shames, and never
jokes at the cost of clarity.

## Anti-references
- The generic AI-dashboard look: gradient text, glass cards, identical card
  grids, purple-blue SaaS defaults.
- Budgeting apps that cheer ("Great job!") or scold.
- Broker apps with flashing tickers.
- Any screen where the joke is louder than the number.

## Design principles
1. The number wins. Legibility and scanability outrank expression.
2. State is never only a color. Every state has a word, a glyph and a sign.
3. Say the true thing plainly, then be funny in one short line.
4. Never hide data and never fake it. Stale or incomplete data is labeled, not
   blanked or zeroed.
5. Spend the boldness in one place per screen.

## Screens (tabs)
Overview, Budget, Transactions, Net worth (with Summary, Investments and Debts
views), My Institutions. Layout and look are specified in `DESIGN.md`.
No financial figure is ever invented: with nothing linked, every screen is
blank and shows dashes or 0.00.

## Constraints
- Money is integer cents everywhere; format at the edge.
- Prohibited data (card and bank-account numbers, credentials) is never stored
  or shown. Account masks are truncated forms and count as restricted data.
- Plaid free tier allows a small number of live Items; My Institutions shows
  the count against the cap.

## Open decisions
Dark-only versus a light theme (the approved direction is dark). Single-user
versus multi-user. Currency (USD assumed). Whether budget limits are set by
hand or suggested from past months.
