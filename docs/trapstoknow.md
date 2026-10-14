# Traps to know

Mistakes that look fine, often pass the gate, and fail somewhere else. Add new
ones here, not in `AGENTS.md`.

## Stack-wide
- **Next.js 16 is not the Next.js you know.** `middleware.ts` is now
  `proxy.ts`. Read `apps/app/node_modules/next/dist/docs/` before writing
  framework code.
- **Read the raw webhook body first.** Plaid's signature covers a SHA-256 of
  the exact bytes. Call `await req.text()`, verify, then `JSON.parse`;
  re-serialising breaks the hash.
- **Plaid `days_requested` is permanent per Item.** Set 730 at first link; it
  cannot be raised later without relinking.
- **Plaid sign conventions differ.** Transactions: outflows positive.
  Investment transactions: inflows negative. Normalise once at ingest.
- **Do not count transfers and card payments as spending or income.** Paying a
  credit card from checking is one event, not two.
- **Do not add holdings on top of an investment account's balance.** The
  balance already includes them.
- **Vercel Hobby cron runs once a day and can fire up to an hour late.** Snapshots
  must be idempotent and the UI must show a stale badge.
- **Money is integer cents.** `Number.isSafeInteger` guard in `formatCents`
  exists on purpose.
- **A missing value is not zero.** `null` renders as an em dash; only a real
  zero renders `$0.00`.

- **A server component cannot read a plain value from a `"use client"` file.**
  Anything exported from one arrives as a client reference, not the string or
  object. Shared class strings (`eyebrow`, `button`) live in `Chips.tsx`, which
  is not a client module, so both kinds of component can use them.

## This repository
- **No financial figure is ever invented.** No seed, fixture, mock or demo
  data drives the app or any screen. The only synthetic values are tiny inputs
  inside unit-test files, which the app cannot reach.
- **Turborepo may append an agent block to `AGENTS.md`.** `turbo.json` sets
  `"agentGuidance": false` to stop that.
- **Google Fonts renamed the family.** It is `Big_Shoulders` in `next/font`;
  `Big_Shoulders_Display` no longer exists.
- **Neon's default roles bypass row-level security.** The role Neon creates
  with the project (and `neondb_owner`) can bypass RLS, so an app connected as
  one ignores every policy and still "works". The runtime connects as
  `mmff_app` (created `NOBYPASSRLS` by `0003_runtime_role.sql`); `DATABASE_URL`
  must be that role's string. `FORCE ROW LEVEL SECURITY` does not help against
  superusers or `BYPASSRLS` roles. The PGlite tests run after `SET ROLE mmff_app`
  for the same reason: as a superuser they would pass vacuously.
- **A test file never boots PGlite and migrates it itself.** A bare
  `new PGlite()` runs `initdb` and compiles a 10 MB WASM module, which takes 3
  to 5 seconds. A dozen files doing that at once overran Vitest's 10-second
  `beforeAll` limit on a cold run. The global setup
  (`src/server/db/pglite-global-setup.ts`) applies the migrations once per run
  and dumps the result. Tests call `openTestDb()` (`src/server/db/test-db.ts`)
  or `setupDb()`, which load a private copy and `SET ROLE mmff_app`. Do not
  "fix" a slow setup by raising `hookTimeout`.
- **`app.owner_id` must be set per transaction, not per session.** Neon's pooled
  string is PgBouncer in transaction mode, so a session `SET` leaks to or
  vanishes from the next request. `withOwner` uses `set_config(..., true)`
  inside `BEGIN ... COMMIT`; never run owner-scoped queries outside it.
- **Pooled for the app, direct for migrations.** Apply migrations and run
  `ALTER ROLE` over the direct (non-`-pooler`) string, as the project owner
  role. The app uses the pooled string for `mmff_app`.
- **Auth fails closed.** With `NEON_AUTH_*` or `OWNER_EMAIL` missing, there is
  no owner: pages render blank, `/api/auth` answers 503, and the proxy sends
  everything protected to sign-in. Do not "fix" a blank screen by loosening
  that. Signing in is not enough either: only the `OWNER_EMAIL` account is the
  owner, so disable public sign-up in Neon Auth after creating it.
- **The proxy is not the guard.** Every server data access calls
  `requireOwner()` or `getOwnerId()` (`src/server/auth`). A page that reads
  per-owner data must also be dynamic (`export const dynamic = "force-dynamic"`)
  or it is prerendered once at build time with nobody signed in.
- **A new table needs its RLS in the same migration.** Copy the block in
  `0002_rls.sql` (enable, force, `owner_isolation` policy); default privileges
  already grant `mmff_app` access. `rls.test.ts` fails the build if any public
  table lacks enabled and forced RLS, an `owner_id NOT NULL` column or a policy.
- **Neon Auth's SDK imports `next/headers` in a way plain Node cannot
  resolve.** Unit tests that import `src/server/auth` mock
  `@neondatabase/auth/next/server`.
- **`/accounts/get` is cached and free; `/accounts/balance/get` is billed per
  call.** The adapter only ever calls `/accounts/get` (balances refresh about
  daily on Plaid's side). Never add the balance endpoint to a screen or a loop.
- **Update mode is not a new link.** Reconnecting an Item calls
  `/link/token/create` with the Item's `access_token` and no `products`; Link
  returns no public token to exchange. The Item keeps its id, so after Link
  succeeds the app calls `/api/plaid/items/[itemId]/refresh` to re-read status
  and clear `needs_reauth`. Do not exchange a token or create a second row.
- **`transactions.days_requested` (730) is set once, in the new-link token.**
  It is permanent for the Item. Changing the constant later affects only Items
  linked afterwards; existing Items must be unlinked and relinked.
- **Liabilities and Investments are `optional_products`, Transactions is
  `products`.** Putting them in `products` would hide every institution that
  lacks one. `optional_products` must not overlap `products`.
- **Unlink calls `/item/remove` before deleting rows.** That call is what stops
  Plaid billing. If it fails (other than ITEM_NOT_FOUND) the rows stay so a
  billed Item is never orphaned. A failure after a successful exchange also
  removes the Item at Plaid.
- **Production Link needs a use case on its Link customization.** Plaid
  enrols US accounts in Data Transparency Messaging, and `/link/token/create`
  in Production answers 400 `INVALID_LINK_CUSTOMIZATION` until the `default`
  customization (the app sends no `link_customization_name`) has a use case.
  Fix it in the Plaid Dashboard: Customize > Link > Data Transparency, select
  one to three use cases, then Publish changes. Sandbox does not check, so it
  only shows up after the switch. It is a Dashboard fix, not code.
- **Production needs two switches.** `PLAID_ENV=production` is refused unless
  `MMFF_ALLOW_PLAID_PRODUCTION=true` is also set (`src/server/plaid/config.ts`).
  `development` is not a valid value. Missing keys fail closed with 503.
- **Credit and loan balances are stored as the positive amount owed.**
  `accounts.is_liability` (type `credit` or `loan`) tells net-worth maths to
  subtract it. Do not negate at ingest, and do not add a liability balance to
  assets. The My Institutions card shows it as a minus amount with "owed".
- **Dollars to cents never uses `Math.round(x * 100)`.** `toCents()` reads the
  cents from a decimal string, because `1.005 * 100` is `100.49999...`.
- **API routes answer 401, they do not redirect.** `ownerRoute()` wraps
  `getOwnerId()` for JSON routes; pages use `requireOwner()`. The header
  `!N` badge fetches `/api/plaid/status` on the client so the layout stays
  static; a 401 or error leaves it blank.
- **A webhook owner lookup is the one unscoped read.** `owner_id` is NOT NULL
  and every table is under FORCE RLS, but a webhook arrives with only a Plaid
  item id. Migration `0004_sync.sql` adds two SECURITY DEFINER functions in a
  `private` schema (`owner_for_plaid_item`, `item_owner_ids`) that return
  owner ids and nothing else; `queryPrivateLookup` in `src/server/db` is their
  only caller and refuses any other statement. They work because the function
  owner (the project owner role on Neon) bypasses RLS. Everything after the
  owner id is known runs under `withOwner`. Do not add other unscoped queries.
- **Verify the webhook before anything else, on the raw text.** The route calls
  `request.text()`, verifies the `Plaid-Verification` JWT (ES256 only, key by
  `kid`, `iat` within 5 minutes, constant-time SHA-256 of the exact body), and
  only then parses, resolves the owner and inserts. A 401 touches no table.
  The stored payload is picked field by field (`pickPayload`) to match the
  `provider_events` CHECK; never `JSON.stringify(body)` into it.
- **Return 200 fast and process in `after()`.** Plaid waits 10 seconds and
  retries non-200 for 24 hours. The processor reads the stored event, is safe
  to run twice (`processed_at` guard plus idempotent upserts) and records a
  short error code, leaving `processed_at` null so a redelivery retries.
- **Plaid sends `SYNC_UPDATES_AVAILABLE` only after the first
  `/transactions/sync` call.** INITIAL_UPDATE and HISTORICAL_UPDATE still
  arrive, but the processor ignores them, so an Item that has never synced
  waits forever. The exchange route runs the snapshot in `after()` (which
  syncs transactions for every active Item and writes today's net worth), and
  the daily cron does the same as a catch-up. Do not make transactions depend
  on the webhook alone.
- **`transactions.source_key` is computed by the database.** The generated
  column in `0006_sorting.sql` is the only definition: the merchant if Plaid
  named one, else the description, lowercase letters only. Read the column;
  never rebuild the key in TypeScript. Descriptions without a payer (for
  example "Mobile deposit #1234") share one key, so they are sorted one
  transaction at a time.
- **Plaid gives a posted transaction a new id.** It points back through
  `pending_transaction_id`. `applyTransactions` copies the owner's choice from
  the pending row to the posted one. A rule needs no copying, because it
  matches on `source_key`.
- **The sorting tables serve both income and the budget.** Since 0009 a rule
  has a `scope`:
  - `deposit` rules carry `income` or `not_income` (M7);
  - `spending` rules carry `planned_item` or `out_of_budget` (M9).

  A merchant can have one of each, so a rule is unique on
  `(owner_id, scope, source_key)`. Any query that joins rules must name the
  scope, or a merchant with both rules returns two rows. Choices have no
  scope (a transaction is either money in or money out), but income logic
  reads only income kinds: `depositStatus` and `DEPOSIT_STATUS_SQL` ignore a
  budget choice, so budget sorting can never move an income figure. The
  merchant key is `transactions.source_key`, the same key income uses (see
  the `source_key` trap above).
- **Learning only reads the owner's own choices** (`lib/learning.ts`, the
  owner's 2026-10-10 decision). A merchant's charge with no choice or rule is
  placed where at least 90% of 3 or more decided charges went, unless it is
  at least 2x their median, which stays in Misc marked large. It is worked
  out when read, never stored, so auto placements never teach themselves.
  Order: the charge's own choice, then the merchant's rule, then learning.
- **Budget rules apply when read, not when written.** A new or edited
  spending rule takes effect on every past transaction from the start date
  on, with no backfill job, and undoing it sends them back to Misc. The order
  is a per-transaction choice, then the merchant's rule, then Misc.
  Deleting a planned item deletes the rules and choices pointing at it, so
  its spending returns to Misc rather than vanishing.
- **A mutation-during-pagination error restarts the whole sync loop.**
  `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` means restart from the cursor
  the loop began with, not retry the failed page. Pages are held in memory and
  written in ONE owner transaction together with the new cursor, guarded by
  `tx_cursor IS NOT DISTINCT FROM <start>`, so a failure never half-applies.
- **Soft-delete removed transactions.** `removed_at` is set; reads must filter
  `removed_at IS NULL`. A later add or modify of the same id clears it.
- **Net worth never adds holdings and never zeroes unknowns.** `computeNetWorth`
  sums account balances only; a null balance is excluded and sets
  `net_worth_daily.incomplete`. With no known balance no row is written.
- **The proxy must leave `/api/cron` and `/api/webhooks` open.** They carry
  their own credentials (`CRON_SECRET`, the Plaid signature); the proxy would
  otherwise redirect them to sign-in. `CRON_SECRET` unset means 401, not open.
- **Cron can fire an hour late and run twice.** The snapshot date is the date
  when it runs in `OWNER_TIMEZONE`, writes are upserts, and balances come from
  the cached `/accounts/get`, so the UI still needs a stale badge (M5).
- **Spending excludes transfers and credit-card payments.** The rule is
  `isFlowExcluded` in `src/lib/flow.ts`, mirrored by `FLOW_EXCLUSION_SQL`, and a
  test runs both over one matrix. Excluded: category `TRANSFER_IN` or
  `TRANSFER_OUT`, category detail `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`, and rows
  with `removed_at` set. Other loan payments are real spending. Pending rows
  count and are tallied separately.
- **A move between the owner's own accounts is neither income nor spending.**
  `isOwnTransfer` in `src/lib/flow.ts`, mirrored by `ownTransferSql`: another
  of the owner's accounts has the same amount with the opposite sign within
  3 days. Plaid labels these `TRANSFER_IN` like a client's Cash App payment,
  so the pair is the proof. It is computed when read (no stored column), so
  new syncs pair old rows too. The owner's own choice on a row beats it.
- **One-time is off-plan spending, like out of budget** (0011). `isOffPlan`
  in `lib/actuals.ts` covers both: each carries its own "For" tag and tax
  category, counts in Spent and as a headline extra, and never in Standing.
  They are separate places for learning (`placementKey`) and separate groups
  on the Ledger. Any SQL that reads a budget choice must list `one_time` with
  `planned_item` and `out_of_budget`, or a one-time charge reads as unsorted.
  A one-time charge may also name one of the owner's `one_time_kinds` (0012):
  what it was, never where it lands for tax. Moving a charge without the
  field keeps its kind, like the other tags; out of budget never has one.
- **The owner can also mark money out a transfer or not spending** (0010).
  A `transfer` choice or spending rule covers payments to the owner's own
  accounts that Plaid does not label as transfers (a credit union, say);
  `not_spending` is per charge only, for money that came back. Both count
  nowhere: `markedTransferSql` and `marked_not_spending` keep them out of the
  SQL spending sums, and `notSpending` in `lib/actuals.ts` out of the budget.
- **Income is sorted by the owner, not inferred.** `depositStatus` in
  `src/lib/flow.ts`, mirrored by `DEPOSIT_STATUS_SQL`, decides in this order:
  1. the owner's choice for that transaction;
  2. the owner's rule for its source;
  3. Plaid's `INCOME` label;
  4. otherwise "unsorted".

  Card payment credits never count. Client payments arrive as `TRANSFER_IN`,
  so excluding transfers from income undercounted it. Any screen that shows
  income reads `deposit_status` through `CLASSIFIED_TRANSACTIONS` in
  `server/reports/repository.ts`. Never sum positive amounts directly. The
  Overview says how many deposits are unsorted, so a low figure is explained.
- **"This month" is the month in `OWNER_TIMEZONE`, not the server's.** Vercel
  runs in UTC, so on the 1st at 02:00 UTC a Los Angeles owner is still on the
  last day of last month. Month maths takes the owner's local date
  (`server/reports/window.ts`) and works on `YYYY-MM-DD` strings. Read SQL dates
  with `to_char(date, 'YYYY-MM-DD')`; the driver turns a bare `date` into a
  local-midnight instant and shifts it a day.
- **Unknown stays unknown on the screens too.** Income, spending and left to
  spend are `null` (an em dash) until at least one transaction has synced;
  once any exists, a month with no income is a real `$0.00`. "Vs this day last
  month" is `null` until a row predates the month. Every loader returns the
  blank shape without an owner, database or rows; add a field by giving it a
  null blank value and a test in `reports.test.ts`.
- **The Spending/Income chips and the totals differ on purpose.** The
  Transactions list shows every non-removed row (transfers carry a "transfer"
  tag); only the Overview and Budget totals apply the exclusions.
- **Search is escaped, not interpolated.** `escapeLike` backslash-escapes `%`,
  `_` and `\` and the query uses `ILIKE ... ESCAPE '\'` with a bound parameter.
- **Spending limits are gone (the owner, 2026-10-10).** The Budget tabs are
  Income, Expenses (the default: this month's headline and the Misc pile)
  and Ledger (`view=ledger`; the old `view=planned` still opens it), where
  the budget and businesses are edited. The `budgets` table is left unread
  for a later migration to drop with the owner's OK; do not read it again.
- **Sums arrive as strings, and PGlite returns numbers.** `cents()` in
  `server/reports/repository.ts` accepts both and returns `null` for anything
  that is not a safe integer; tests that compare raw `bigint` columns need
  `Number()`.
- **No BigInt literals.** The TypeScript target is below ES2020, so `0n` fails
  typecheck; use `BigInt(0)`.
- **The count-up never owns the number.** `CountMoney` renders the final figure
  in the server HTML and a never-changing screen-reader copy beside it; only
  the aria-hidden visible copy is animated, by writing the text node React
  rendered (not `textContent`, which would replace the node and desync React).
  It runs once per figure per page load, is skipped under
  `prefers-reduced-motion`, and is marked done on completion, not on start,
  because React's dev double-invoke would otherwise cancel it for good.
- **A CSP needs three Plaid sources and a per-request nonce.** See
  `security-headers.ts`: the Link script on `cdn.plaid.com`, `frame-src` for
  the Link iframe and `connect-src` for the Plaid API host. Edit the policy in
  that file only, and update its test.
- **The CSP is set by the proxy, not `next.config.ts`.** `src/proxy.ts` makes
  a fresh nonce per request and sets the policy on both the response and the
  request; Next reads it from the request and stamps its own scripts. Three
  things keep that working:
  1. The root layout calls `connection()`, so every page renders per request.
     A page prerendered at build time has no nonce, and the policy blocks its
     scripts: it shows as server HTML that never becomes interactive.
  2. Sign-in pages are matched by the proxy for the nonce but skip the gate
     (`OPEN_PAGES`). Taking `/auth` out of the matcher again would leave them
     without a policy.
  3. Neon Auth's middleware copies the request headers it is given into its
     `NextResponse.next()`, so the proxy hands it a request that already
     carries the nonce.

  Do not add `'strict-dynamic'`: it switches off the host allowlist, which is
  what keeps the Plaid script the only third-party script allowed. On
  `next start` over plain http, `upgrade-insecure-requests` rewrites a page's
  own `fetch()` calls to `https://localhost`, which fails. That is local
  only; Vercel serves https.
- **Only `src/server/log.ts` may call `console`.** `log.test.ts` fails the gate
  on any other file. Log an exception with `logException(event, err)`, which
  records its class name and `code`, never its message: messages from the
  database driver or a vendor can carry a query, a value or a token.
- **OAuth banks need three things, not one.** `PLAID_REDIRECT_URI` on the Link
  token, the same address in the Plaid Dashboard's "Allowed redirect URIs", and
  the return page at `/oauth/plaid`. With any one missing the bank either never
  opens or never comes back. The URI must be `https`, end in exactly
  `/oauth/plaid`, and carry no query string, fragment or wildcard; the adapter
  config refuses anything else (`parseRedirectUri`), and Production never
  accepts `http://localhost`.
- **The return page needs the same link token as the page that started Link.**
  A new token would lose the OAuth state. The token is kept in `localStorage`
  (`src/lib/plaid-oauth.ts`, Plaid's documented approach; `sessionStorage`
  is empty if the bank hands back in another tab), expires after 30 minutes
  and is cleared the moment Link finishes. It is not the access token. Never
  log it, and never clear it before Link has used it.
- **Resolving the OAuth return does not consume the stored token.** Link
  clears it in `onSuccess` or `onExit`. A page reload mid-flow must still be
  able to resume; clearing on read would turn a refresh into "expired".
- **Re-encrypting after a key rotation is a script, not a migration.**
  `apps/app/scripts/rotate-token-key.ts` runs under Node's own type stripping,
  so every file in its import graph (`rekey.ts`, `rotate-items.ts`,
  `tokens.ts`, `run-with-owner.ts`) imports with a `.ts` extension and must not
  use the `@/` alias or extensionless paths; `tsconfig.json` allows this with
  `allowImportingTsExtensions`. Keep both keys set while it runs, remove the old
  one only after an `--apply` run reports no failures, and never print anything
  but counts from it.
- **An unticked checkbox sends nothing, so a missing "always" means one at a
  time.** `markSourceAction` makes a source rule only when the form carries
  `always=1`; otherwise it records a choice for each ticked `transactionId`
  (`setTransactionChoices`). Never default a missing `always` to a rule, or
  unticking the box would quietly decide every later deposit too.
- **The Income chart draws only what it knows.** Future months and months
  before history are a dash, never a zero-height bar; a known month with no
  income is a tick on the baseline. Partial months are striped and stay out
  of the high, the low, the average and the trend (a three-month average of
  complete months, `lib/income-chart.ts`). The drawing is `aria-hidden`: its
  caption and the month table under it are the text alternative, so a change
  to the chart must keep the table.
- **Write modules never import `src/server/auth`.** A write such as
  `createItem` or `setSourceRule` takes `run` and returns a `WriteResult`
  (`src/server/write-result.ts`). Only `ownerWrite` in `owner-write.ts` checks
  the owner and refreshes the page. Keeping auth out of the write modules lets
  their tests run on PGlite without mocking the Neon Auth SDK.
- **Planned items go one level deep, and the database enforces it.** The
  trigger `private.planned_items_one_level` refuses a sub-item of a sub-item.
  A sub-item's frequency is part of its foreign key to its parent,
  `(owner_id, parent_id, frequency)`, with `ON UPDATE CASCADE`. Change the
  parent's frequency and its sub-items follow; never write a sub-item's
  frequency on its own. A sub-item has no "For" tags of its own; it is for
  whatever its parent is for. An item with sub-items keeps a stored amount,
  but its total is its active sub-items' total, so `updateItem` refuses a
  typed amount for it.
- **Reference data lives in the `reference` schema, not `public`.** Every
  public table must have `owner_id` and RLS, and `rls.test.ts` fails the build
  otherwise. Schedule C lines belong to no owner, so
  `reference.schedule_c_lines` (0008) sits in its own schema. `mmff_app` has
  USAGE and SELECT there and nothing else. A new tax year adds new rows,
  copied from the printed form with their `source_url` and `checked_on`; never
  edit an earlier year's rows, because owners' mappings point at them. The
  starting set's proposed lines (`STARTING_CATEGORIES`) must exist there, or
  `addStartingCategories` fails on the foreign key.
- **React clears a form after every action, even a refused one.** A plain
  `<form action={...}>` loses what the owner typed when the server says no.
  `ActionForm` submits by hand (`onSubmit` plus `startTransition`), so a
  refused save keeps the typed values. `resetOnSave` clears an "add" form only
  after a save. Use `ActionForm` for edit forms on the Budget page.
- **Actuals are unknown until checking starts, then a real zero.** Before any
  transaction has synced, or while `budget_settings` has no start date for
  the owner, every actual is null (a dash), and the header's Misc badge stays
  blank. After that a line with nothing matched is $0.00. The start date only
  bounds the Misc pile: spending before it still counts in the Annual view
  (a choice or rule places it; otherwise it is unsorted), so Spent is every
  real purchase in the period (`periodSpentCents`), never just what was sorted.
- **The headline is income minus need minus extras** (`lib/month-standing.ts`,
  the owner's 2026-10-10 decision). Need is the monthly items plus a twelfth
  of the annual items, rounded up. Extras are out-of-budget and unsorted
  spending plus each monthly line's spending past its plan; a line under plan
  never raises the figure. The Overview pill and dial and the Planned tab read
  it; never compute a "left to spend" from income minus spending again.
- **Money in counts against the budget only as a refund.** A deposit from a
  merchant with a spending rule reduces that line's actual, unless the
  owner's income sorting counts it as income. A deposit that is income is
  never also a refund, and a deposit with no spending rule never lands in
  Misc; it belongs to the Income tab's Unsorted deposits.
- **Each view compares its own items only.** Monthly shows monthly items and
  Annual only annual ones (the owner, 2026-10-10; monthly items times 12 is
  gone). Each view's `totalCents` leaves out the other frequency's matches;
  out-of-budget spending counts in both. The hero's Spent is
  `periodSpentCents`, which counts every purchase in the period whatever it
  was matched to.
- **Standing is not planned minus Spent.** The hero and footer Standing
  compare the planned total with `plannedSpentCents`: spending matched to
  line items being paid (and, for a sub-item, whose parent is being paid).
  Out of budget and not-paying matches stay in Spent but never in Standing,
  so the screen names the compared figure when the two differ. Read it
  through `planVerdict`; never compute a Standing from `totalCents`.
- **A tag field the form leaves out is not None.** In `matchSpending` and
  `addSubItem`, a missing field (`FormData.get` gives null) keeps or
  inherits the tag; `""` is the owner choosing None. A form that posts only
  some fields (the charges list's Move cell) relies on this.

