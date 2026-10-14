---
status: active
---

# MMFF-App build plan: the real app, real data, no fakes

## Status
Milestones M1 to M6 are built in this repository (M1 to M5 merged, M6 on its
own branch awaiting review). What each delivered:

- **M1** scaffold and blank-state shell, five routes, tokens and fonts.
- **M2** migrations, row-level security with second-account tests, single-owner
  Neon Auth, AES-256-GCM token encryption, integer-cent money helpers.
- **M3** Plaid Link (new and update mode), exchange, encrypted Item storage,
  accounts and cached balances, My Institutions live.
- **M4** cursor-based transaction sync, signed webhook route and processor,
  liabilities and holdings, daily snapshot cron.
- **M5** Overview, Budget, Transactions and Net worth reading real data and
  degrading to dashes.
- **M6** log-redaction audit and an allowlisted logger, security headers and a
  Plaid Link aware CSP, budget limits for any category, the hero count-up,
  an accessibility pass with a contrast test, and the launch runbook.

Still gated on the owner (nothing here is built by an agent): the operator work
in issue #2 (Plaid Production access and OAuth registration, funding and
contracts, a `LICENSE`), applying migrations to the production Neon branch,
the Vercel project and its environment variables, and switching Plaid to
production. The ordered checklist is [`docs/LAUNCH.md`](../LAUNCH.md). Done
since: the OAuth redirect flow for Plaid Link (#13), re-encrypting Items under
a new `TOKEN_ENC_KEY` version (#14), and a per-request CSP nonce in place of
`'unsafe-inline'` for scripts (#15). Open code gaps, filed as issues: reading
auto and other loan details from Plaid Liabilities (#19), and a CI workflow
(#16, which needs the owner's sign-off).

**Next: M7 Income, then M8 Planned budget, then M9 Budget vs. actual**
(specified below, all requested by the owner on 2026-10-07). M7 starts after
M6's remaining buildable issue, #19 (the adapter reads only `credit`,
`mortgage` and `student` liabilities today), so the work order holds. Income
was put first by the owner because the Overview's income is wrong today and
Income does not need the planned budget. They are written into the plan now so
the plan describes the end product the owner wants. M7's code is now built:
the sorting tables (#32), one income definition (#33) and the Income sub-tab
on the Budget page (#34). What remains of M7 is operator issue #35.
M8's code is built too: the planned budget tables and writes (#21, migration
0007), the totals module (#22), the owner's tax categories mapped to the 2025
Schedule C lines (#23, migration 0008) and the Planned and per-business
Budget tabs (#24). Operator issue #25 remains: the owner's review of the
proposed category-to-line mapping.
M9's code is built as well: budget targets on the sorting tables and the
budget start date (#27, migration 0009, start date 2026-10-01), the planned
vs. actual and Misc logic (#28) and the Misc prompt, the Budget tab's Misc
badge and planned against actual on every planned tab (#29). Operator issue
#30 remains: the owner confirming the start date.
A design pass on the Budget tables (#36) followed, at the owner's request on
2026-10-09, as a named exception to the milestone order (see "Budget tables
design pass" below).
M10's code is built (2026-10-10): the honest headline (#43), own-account
transfer pairing (#44), the Income, Expenses and Ledger tabs with Spending
limits removed (#45), per-charge sorting in Misc (#46) and learning from the
owner's choices (#47). Operator issue #48 remains, and a per-charge "Not
spending" choice waits on the owner's approval of migration 0010.

## Context
The Overview design is approved (Mirror + Dial, neon on black; see
`PRODUCT.md`, `DESIGN.md`). The owner wants the whole app built for real:
Plaid, Neon, Vercel, auth, cron. **No financial data is ever faked.** Nothing in
the repo generates, seeds, fixtures or mocks financial figures. With no linked
institution every screen renders blank: dashes or `0.00`, nothing invented.

How "real data" squares with AGENTS.md: the app only ever reads Plaid and
Neon. Development runs against Plaid's **sandbox** (Plaid's own documented
test institution, which is Plaid's data, not ours) and a Neon dev branch; the
owner links real banks only in the production deployment. I never enter or
read real credentials, and never run migrations against production.

## Rules carried from AGENTS.md
Money is integer cents. No vendor calls from screens or route handlers
directly (adapter interfaces: `PlaidProvider`, `Database` access in `src/server`).
Webhooks are signature-verified, stored raw in `provider_events`, then
processed. Access tokens are encrypted. RLS on every table with a second-account
test. Gate runs locally, never on Vercel. Ask before new dependencies and
before commit, push or PR.

## Empty state is the default (design rule, replaces any sample data)
- Numerals show `—` when unknown and `$0.00` only when the real value is zero.
- Dial: empty outline rings, no deficit text. Charts: axes with no line.
  Tables: "Nothing here yet" row. Budget bars: empty tracks. My Institutions:
  "0 of N linked" and the Link button.
- Delete `docs/design/prototype.dc.html` (it contains made-up figures) and fix
  the "made-up sample data" line in `PRODUCT.md`. Layout reference is
  `DESIGN.md` plus screenshots of the built app.

## Architecture
- Next.js 16 on Vercel, Neon Postgres, Plaid (Transactions, Liabilities,
  Investments), Vercel Cron.
- `src/server/plaid/` adapter: link-token (new and update-mode), exchange,
  accounts, transactions sync, liabilities, holdings, webhook verify.
- `src/server/db/`: Neon serverless driver, per-request transaction that sets
  the owner id for RLS; migrations as SQL files.
- `src/server/crypto/`: AES-256-GCM (random IV, key version) for access tokens;
  key in env var `TOKEN_ENC_KEY`; decrypt only immediately before a Plaid call.
- Auth: single owner. Proposal: Neon Auth with sign-up disabled after the first
  account (see decisions). Every route and cron route is authenticated; cron
  uses `CRON_SECRET`.
- Env vars (names only, never values in repo): `DATABASE_URL`, `PLAID_CLIENT_ID`,
  `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOK_URL`, `TOKEN_ENC_KEY`,
  `CRON_SECRET`, auth keys. Ship `.env.example` with empty values.

## Schema (integer cents everywhere; RLS by owner on all tables)
`items`, `accounts`, `balance_snapshots`, `transactions`, `securities`,
`holdings`, `liabilities`, `budgets` (owner-set category limits),
`net_worth_daily`, `provider_events` (unique on a hash of body + type + code +
item_id). Plaid sign conventions normalised at ingest (spending negative,
income positive), with tests.

M7 adds, under the same RLS: the owner's `businesses`; a generic
`transaction_rules` table (a normalised source key mapped to what its
transactions are: `income` or `not_income` in M7, and planned line items or
"out of budget" in M9); a per-transaction choices table that beats a rule;
and `transactions.pending_transaction_id`, so a choice carries from a pending
row to the posted one.

M8 adds the planned budget, all owner-entered and under the same RLS:
`planned_items` (name, amount in cents, frequency, status, notes, tax
category, and an optional parent for a sub-item), the tag table linking items
to M7's `businesses`, and the owner's `tax_categories`,
each mapped to a Schedule C line. The Schedule C line list is reference data
that varies by jurisdiction and tax year. It lives in the database with a
source link and a last-verified date, not in screen code.

## Money logic that must be right
- Spending for the hero excludes transfers and credit-card payments (Plaid
  personal finance categories) so nothing counts twice. Income does too until
  M7 replaces the income side with the owner-sorted definition below; after
  that, one definition of income serves every screen.
- Net worth uses account current balances; credit and loan accounts subtract;
  investment account balances are not double counted with holdings.
- Daily snapshot is idempotent (`ON CONFLICT`), dated in the owner's timezone.
  Hobby cron runs once a day and may drift up to an hour; show a stale badge.

### Income (M7), decided with the owner on 2026-10-07
Why: a count of the owner's 2026 deposits showed 64 skipped as transfers (25
"from apps", 20 "deposit", 19 others), while interest, "other", refunds and a
loan disbursement counted as income. Client payments arrive through apps and
plain deposits, which Plaid labels `TRANSFER_IN` just like the owner moving
their own money. Plaid cannot tell them apart, so the owner decides.
- **Sorted by the owner, remembered.** Deposits whose Plaid primary category
  is `INCOME` count automatically. Credit-card payment credits are internal
  and never shown. Every other deposit lands in **Unsorted deposits**,
  grouped by source; the owner marks the source Income or Not income (own
  transfer, refund, loan), and "always do this for <source>" makes a rule. A
  per-transaction choice beats a rule. Sorting covers all synced history, so
  the yearly chart is right. ("Every deposit except own transfers" and "only
  Plaid's income label" were offered and declined.)
- **One definition everywhere.** The Overview hero, "left to spend" and the
  Income tab use the same income function; the TypeScript rule and its SQL
  mirror change together. While deposits in a month are unsorted, the
  Overview says so rather than showing a silently low figure. (Keeping the
  Overview on the old rule was offered and declined.)
- **Income sources can carry a "For" tag** (Personal or one of the owner's
  businesses), so business tabs show that business's income.
- **The Income sub-tab** on the Budget page, next to Spending limits: a bar
  per month with a smoothed trend line, the highest and lowest complete
  months highlighted, a monthly-average line, the deposits listed under each
  month with monthly totals and the year total, and a year switcher over the
  synced history. Hand-built SVG in the MMFF theme. Future months and months
  before history are dashes, not $0.00; the current month is marked partial
  and is left out of the low month and the average. Hovering a bar (or
  tapping it on a phone) floats that month's full total above it, with a note
  for the high, low, partial and unknown months (asked for by the owner on
  2026-10-09). The readout is pointer-only; the month table stays the text
  alternative.

### Planned budget (M8), decided with the owner on 2026-10-07
The planned budget is what the owner *intends* to pay, typed in by hand like
the owner's Notion "Monthly Expenses" and "Annual Expenses" tables. It sits
beside the existing category limits, which track real Plaid spending; neither
replaces the other.
- **Columns:** name, amount, frequency (Monthly or Annual), "For" (Personal,
  or one or more of the owner's businesses), tax category, notes, status.
- **Shared business costs are tags, not splits.** An item serving several
  businesses is tagged with each and counts its full amount once; filtering
  by one business shows the full amount. (Splitting the cost per business
  was offered and declined.)
- **Status.** "Not currently paying" keeps the row in the table, greyed out,
  and leaves it out of every total, including its parent's. It is for costs
  paid only some of the time.
- **Embedded budgets.** Any item can be broken into sub-items, one level
  deep. Once an item has sub-items, its amount is the sum of its active
  sub-items and cannot be typed over. A sub-item has the same frequency as
  its parent (mixed frequencies were offered and declined). A sub-item has
  its own tax category, defaulting to its parent's.
- **Views.** Monthly: the monthly items. Annual: the annual items plus each
  monthly item times 12 (changed by the owner on 2026-10-10: each view shows
  only its own items; see M10).
- **Sub-tabs on the Budget page:** Spending limits (the existing page), Planned
  (everything, with a Personal filter), and one tab per business the owner
  adds, each with its own totals and tax breakdown. Business names are the
  owner's data, never hard-coded. Because shared costs are tags, a business
  tab counts a shared cost in full, so the business tabs can add up to more
  than Planned; the tab says so wherever it applies.
- **Tax categories are the owner's own list**, starting from the owner's
  spreadsheet (Accounting, Advertising, Car / Truck / Expense - Fuel, ... ,
  Other: Recreational). Each category is mapped once to a Schedule C expense
  line, or marked personal. Totals can be shown by the owner's categories or
  by Schedule C line. Line numbers and names are copied from the current
  Schedule C (2025 at the time of writing, irs.gov/forms-pubs/about-schedule-c-form-1040)
  when built, never from memory. The app records the category the owner
  chose; it never states that anything is deductible.
- **Money.** Amounts are integer cents. Sums are exact; nothing is rounded
  until display. No figure is pre-filled: a new table is empty.
- **Not in M8:** matching planned items to real transactions. That is M9,
  below.

### Budget vs. actual (M9), decided with the owner on 2026-10-07
The budget checks real transactions against the planned budget. Each
spending transaction from the start date on goes to exactly one place: a
planned line item (or sub-item), **Out of budget**, or **Misc**.
- **In scope:** spending only, with `removed_at` null. Transfers and
  credit-card payments are excluded by the same rule as the Overview totals
  (`src/lib/flow.ts`), so nothing counts twice.
- **Start date:** the first day of the month M9 goes live, in the owner's
  timezone. Earlier history is not checked. (Jan 1 and all history were
  offered and declined, to keep the first Misc pile small.)
- **Matching learns from the owner, it never guesses** (changed by the owner
  on 2026-10-10; see M10). Misc is grouped by
  merchant; the owner adds the merchant to an existing line item, makes a
  new line item from it (prefilled with the merchant and the real amount),
  or marks it out of budget. "Always do this for <merchant>" makes a rule
  that handles later transactions; any rule can be undone. A per-transaction
  choice beats a rule. (Auto-guessing and sorting every transaction by hand
  were offered and declined.)
- **Out of budget** may carry the optional "For" tag and tax category, so
  business and tax totals of actual spending are complete.
- **Planned vs. actual:** monthly items against the current month, annual
  items against the year to date, both in the owner's timezone. A parent's
  actual includes its sub-items' matches. A refund from a matched merchant
  reduces the actual. A "not currently paying" item still collects matches.
- **Standing compares the planned total with spending matched to paying line
  items.** Out of budget and not-paying items' matches show in Spent and the
  totals, but not in Standing, and the hero and footer say what Standing
  compares when Spent shows more (`plannedSpentCents` in `lib/actuals.ts`,
  `planVerdict` in `lib/budget-table.ts`). Decided by the owner on
  2026-10-09; comparing against all spending, and showing both, were offered
  and declined.
- **Prompt:** a Misc count badge on the Budget tab.
- **Not in M9:** splitting one transaction across several line items.

### Budget tables design pass (#36), asked for by the owner on 2026-10-09
Why: the owner reviewed the Budget screens built in M7 to M9 and called the
tables and the UI "really bad". The screens were built for correctness first:
planned items were stacks of labelled inputs with a Save button per row, and
sorting deposits and Misc took several loud blocks per source. If sorting and
keeping the plan current are painful, the owner will not do them, and every
figure that depends on that sorting stays wrong.
- **Every Budget tab reads as a Notion-style database table** (the owner's
  words: "they all should look like database tables like notion, but in
  different tabs"). View tabs sit above each table, headers carry a type
  glyph, and footers show only totals the lib computes.
- **Direction A, "Nested database", was chosen from three drawn on a Claude
  Design canvas with made-up figures.** Cells are edited in place and the
  whole row is saved through the existing server actions, with no Save button.
  Sub-items and matched charges open as indented rows under a toggle. Each row
  has one menu (stop paying, add a sub-item, show matched charges, delete with
  an inline confirm). Misc and Unsorted deposits become small "To sort" tables
  with a "Sort to" choice and an "Always" box. The Income month table turns
  sideways into twelve rows. On a phone each table scrolls sideways inside a
  box with the name column pinned, and the verdict sits under each name.
  ("Inbox and peek", where rows are read-only and all editing happens in a
  side panel, was declined because editing would be one step away from the
  cell. "Grouped ledger", a spreadsheet grid with keyboard cell navigation,
  was declined as the weakest on a phone and for screen readers.)
- **"Always" starts ticked** when sorting a merchant or a deposit source, as
  before. A missing "always" still means one at a time.
- **Nothing load-bearing changes:** totals come only from
  `lib/planned-budget.ts`, `lib/actuals.ts`, `lib/income.ts` and
  `lib/budget.ts`; unknown is a dash; money is integer cents; every write goes
  through the existing server actions, unchanged in shape.
- **Not in this pass:** the Transactions and Net worth tables.
- **Why it runs out of order:** M7 to M9's remaining issues (#25, #30, #35)
  wait on the owner, and the owner asked for this pass before using the new
  screens for that work. It changes no schema and needs no migration.

### Honest budget (M10), decided with the owner on 2026-10-10
Why: on real data the Overview said the owner had money left to spend in a
month when their income was below what their own budget says they need. The
headline never compared income with the planned budget, unsorted spending
fell out of the comparison, and transfers between the owner's own accounts
could read as income. The owner also found the Budget screens hard to work:
an unused Spending limits tab, an Annual view mixed with monthly items, no
obvious way to create a business, and a Misc pile that asks about everything.
- **The headline is income minus budget minus extras:** income this month,
  minus the monthly Ledger total, minus spending the plan does not cover
  (out of budget, still unsorted, and any line's spending beyond its plan).
  Negative reads as a shortfall in words. The Overview and Expenses show the
  same figure from one function. ("Income minus budget" alone and "income
  minus actual spending" were offered and declined.) The month's need is the
  monthly items plus a twelfth of the annual items, rounded up to the cent
  (the owner: "money in versus money out ... how much I need every month to
  pay for everything"). Spent counts every real purchase in the period,
  sorted or not and before the start date too; the start date bounds only
  the Misc pile. The Planned (Ledger) tab's hero also shows income made in the
  view's period against its planned total (asked for on 2026-10-10).
- **Own-account transfers are paired automatically:** a deposit and a
  withdrawal of the same amount between two of the owner's linked accounts
  within 3 days. Both halves are never income or spending; a per-transaction
  choice unpairs. (Sorting them by hand was offered and declined.)
- **Budget tabs are Income, Expenses and Ledger** (Ledger is the renamed
  Planned, where the budget everything is checked against is edited), plus a
  tab per business. Spending limits is removed. Monthly and Annual each show
  only their own items. Businesses are created on the Ledger.
- **The decider** groups spending by merchant, and each transaction in a
  group can go to its own Ledger item or Out of budget.
- **Learning:** a merchant's spending is placed automatically once the owner
  has decided at least 3 of its transactions with 90% to one place; a
  purchase at 2x the merchant's median goes to the decider anyway. Auto
  placements are marked and undoable. ("After 1 decision" and "suggest
  only" were offered and declined.)
- **One-time spending (the owner, 2026-10-10, migration 0011):** a charge,
  or a merchant through an Always rule, can be sorted One-time: real spending
  the owner does not expect to repeat, so it never becomes a Ledger line. Like
  out of budget it carries a "For" tag (Personal or a business) and a tax
  category, counts in Spent, the business tabs and the tax totals, and is an
  extra in the headline. Learning treats it as a place of its own, so a
  merchant bought from only now and then is learned as one-time. ("Not
  counted at all" and "counted but shown as its own headline figure" were
  offered and declined.) The owner also confirmed that tagging Ledger items
  Personal or a business through the "For" column already does what they
  wanted.
- **One-time kinds (the owner, 2026-10-10, migration 0012):** one-time
  spending is broken down by the owner's own list (Eating out, Clothes, ...),
  kept beside Businesses on the Ledger. Each one-time charge or rule may name
  one kind, separate from its tax category, and the Ledger's One-time group
  opens into a row per kind with its total and charges. Removing a kind
  leaves its purchases one-time with no kind. (Reusing the tax categories and
  grouping by Plaid's categories were offered and declined.)
- **Spent and left over on the Income tab (the owner, 2026-10-10):** under
  the year's income, the Income tab shows every real purchase in the same
  year ("Spent in <year>") and what was left over, or "Spent past income" in
  red. It is the catch-up page's year flow (`lib/year-flow.ts`) over the
  months whose income is known, so Spent uses the Expenses tab's rule
  (`countedSpending` in `lib/actuals.ts`): transfers, card payments and
  charges marked not spending are left out, and unsorted spending counts.
- **Decisions this changes:** M5's spending limits and two-basis "left to
  spend", M8's Annual view (monthly items times 12), and M9's "matching
  never guesses". Those lines above stay for history, marked here as changed
  by the owner on 2026-10-10.

## Milestones (also GitHub milestones and issues, per AGENTS.md work order)
- **M0 Operator (needs the owner):** Plaid account and Trial limits, whether
  OAuth banks work on Trial, Production access application; Neon project;
  Vercel project and env vars; GitHub issues access. I stop and ask here;
  I do not work around it.
- **M1 Scaffold and shell:** Turborepo and pnpm, `apps/app` (Next 16, Tailwind,
  shadcn, Vitest), tokens, fonts, header with tabs, all five routes rendering
  the empty state. Missing doc files AGENTS.md references get written
  (`docs/LOCAL-DEV.md`, `docs/trapstoknow.md`, `docs/plan/IMPLEMENTATION-PLAN.md`).
- **M2 Data and security:** migrations, RLS plus second-account tests, auth,
  token encryption, `money.ts` with unit tests.
- **M3 Plaid linking:** Link flow, exchange, encrypted item storage, accounts
  and balances, My Institutions live (status, reconnect via update mode).
- **M4 Sync:** `/transactions/sync` with cursor, `days_requested` 730 at first
  link, signed webhook route, processor job, liabilities, holdings, daily
  cron snapshot.
- **M5 Screens live:** Overview hero and dial, Budget (limits stored in Neon),
  Transactions, Net worth with Investments and Debts views, all reading real
  data and degrading to dashes.
- **M6 Hardening and launch:** a11y and motion critics, log redaction check,
  production deploy by the owner, switching Plaid to production is the owner's
  call.
- **M7 Income:** deposits sorted by the owner with remembered source rules,
  one income definition across the app, and the Income sub-tab, per "Income
  (M7)" above. Epic #31; issues, in order: #32 the shared rules and choices
  tables under RLS (M9 extends them), #33 the income definition and income by
  month, #34 the Income sub-tab. Operator issue #35 covers the production
  migration and sorting the first deposits. Before M7, M6 finishes #19 (auto
  and other loan details from Plaid Liabilities); #15 (CSP nonce) is done.
- **M8 Planned budget:** the owner-entered monthly and annual budget with
  embedded sub-budgets, business tags and tax categories, per "Planned budget
  (M8)" above. Epic #20; issues, in order: #21 schema and writes under RLS,
  #22 the totals logic, #23 tax categories mapped to Schedule C, #24 the
  Budget sub-tabs (Planned and one per business). Operator issue #25 covers
  applying the migration to the production branch and the owner's review of
  the category-to-Schedule C mapping. Follows M7.
- **M9 Budget vs. actual:** transactions checked against the planned budget,
  the Misc prompt and merchant rules, per "Budget vs. actual (M9)" above.
  Depends on M8's tables, so it follows M8. Epic #26; issues, in order: #27
  line items and "out of budget" added to M7's rules and choices tables, and
  the start date, under RLS, #28 the planned
  vs. actual and Misc logic, #29 the Misc prompt and planned vs. actual on
  the Budget tabs. Operator issue #30 covers the production migration and
  confirming the start date.
- **Design pass on the Budget tables (exception to the order, #36):** asked
  for by the owner on 2026-10-09, per "Budget tables design pass" above. It
  runs after M9's code and before the owner's M7 to M9 checks, because those
  checks are done on these screens.

- **M10 Honest budget:** per "Honest budget (M10)" above. Epic #49; issues,
  in order: #43 the headline, #44 own-account transfers, #45 the Income,
  Expenses and Ledger tabs (Spending limits removed), #46 the decider, #47
  learning from the owner's choices. Operator issue #48 covers the owner's
  checks. Follows M9 and the design pass.

First PR is M1 on `claude/design-overview`; each later milestone gets its own
branch and PR, never merged by me.

## New dependencies to approve (named, with reason)
next, react, react-dom, typescript, tailwindcss, shadcn (copied components),
clsx, tailwind-merge, vitest, @testing-library/react, eslint config, turbo;
later: `plaid` (official SDK, behind the adapter), `@neondatabase/serverless`,
`jose` (webhook JWT), Neon Auth SDK. Fonts: Big Shoulders Display and Barlow
(OFL). Hand-built SVG charts, no chart library.

## Testing without faking the app's data
- Pure logic (money formatting, sign normalisation, transfer exclusion,
  net-worth maths) is unit-tested with tiny synthetic inputs that live only
  inside the test files, never displayed, seeded or reachable by the app.
- Plaid behaviour is verified against Plaid sandbox only. RLS tests create
  throwaway accounts on a Neon dev branch.
- Screenshots (Playwright) cover empty state at 390px and 1440px for every
  route, plus sandbox-linked state on localhost.

## Decisions I need (defaults in brackets)
1. Auth for the single owner? [Neon Auth, sign-up closed after first account]
2. Commit the existing docs on this branch now? [yes; Neon skills left out]
3. May I delete `docs/design/prototype.dc.html` and fix PRODUCT.md? [yes]
4. Scope and port? [`@mmff`, 3100]
5. OK that unit tests use tiny inline inputs inside test files? [yes, flagged
   in `docs/trapstoknow.md`; nothing else is synthetic]
6. File the GitHub milestones and issues first (needs repo access)? [yes]

## Verification
- Gate green locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- `pnpm dev`: every tab renders dashes on black with no linked item. Link Plaid
  sandbox, confirm balances, transactions, reconnect flow and webhook handling
  (signed test event) update the screens.
- Repo grep proves no fake financial data: no seed or fixture files, no
  `fake*`/`mock*` data sources, no hard-coded dollar amounts outside tests.
- RLS second-account test returns nothing; token column is ciphertext.
