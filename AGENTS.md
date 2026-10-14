# My Mutha Effin Finance App (MMFF-App) — agent instructions

<!--
Template note: this file holds the rules every MMFF-App build shares. Before the
first build issue starts, fill in each place marked "the product's plan fills
in": the data-class lists, the adapter interface names, the hard dates and the
sign-off gate. Then delete this comment.
-->

MMFF-App is a personal finance dashboard. This repository is the app. The work is tracked
as GitHub issues and milestones here, one issue per numbered entry in the plan.

## Layout

A Turborepo and pnpm-workspaces monorepo:

- `apps/app` is the Next.js 16 app (`@scope/app`, port `<PORT>`).
- `packages/*` holds shared code as issues need it (see `packages/README.md`).
- `docs/` holds the plan copy, `docs/LOCAL-DEV.md` and `docs/trapstoknow.md`.

The gate is `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, run
locally (see `docs/LOCAL-DEV.md`). Next.js 16 renamed `middleware.ts` to
`proxy.ts` and changed other conventions; read `apps/app/node_modules/next/dist/docs/`
before writing framework code.

## Read this first: the plan is the source of truth

The plan is **`docs/plan/IMPLEMENTATION-PLAN.md`** in this repository (see
`docs/plan/README.md`). Once it is marked `status: active`, it is the source of
truth for MMFF-App. Plan changes land in the same pull request as the code
that needs them.

- **The decisions in §1 of the plan are settled. Do not reopen them.** If code
  or an issue seems to need a different decision, stop and ask; do not quietly
  build around one.
- Older pitch or research documents about the product are read for reasoning,
  never for current fact. Where one disagrees with the plan, the plan wins.
- Any part of the plan marked UNVERIFIED is resolved by an M0 issue before it
  is built on.

## Operator work

Some work in every milestone needs a person: signing vendor contracts, funding
accounts, counsel's or compliance approvals, switching providers to live mode,
recruiting pilot users, and changing the agent environment's network access and
secrets. Each milestone has an issue titled `Operator (Mx): …` listing that
work. If an issue in order needs something only the owner can do, point at the
operator issue and ask; do not work around it.

## Work order: develop the issues in milestone order

**The owner wants development to follow the plan's phases in order**:
M0 → M1 → M2 → …, as listed in the plan's sequence section. Each phase is a
GitHub milestone of the same name, and each milestone's epic lists its issues
as sub-issues.

- **Always take the next issue from the earliest milestone that still has open
  work.** Within a milestone, go in the plan's issue-number order unless an
  issue's Notes name a dependency that changes it.
- **Do not start an issue in a later milestone while an earlier milestone has
  open issues you could work on.** Out-of-order work is how a plan's
  foundations get skipped: a screen built before the rules layer it reads, or a
  provider adapter built before the sensitive-data handling it depends on.
- **M0 is diligence and operator work** (vendor accounts, contracts, counsel,
  anything the plan marks UNVERIFIED), done mostly by people rather than
  agents. Code starts at M1 with its first issue, the scaffold.
- **Any exception to strict order is named in the plan** (for example, a
  launch-hardening milestone that runs alongside the build milestones because
  each item must land before the go-live it guards). Follow the plan's
  exception; do not invent one.
- **If the next issue in order is blocked** (waiting on a vendor, counsel or the
  owner), say so and **ask the owner before moving ahead** to a later issue. Do
  not quietly skip forward.

## The legal and compliance gate

**If the product's plan names a sign-off gate (counsel's, a regulator's or a
compliance reviewer's), no build issue that ships a legal claim starts before
it.** Issues in M0 (diligence) and scaffold work that carries no legal claim can
proceed. Anything that ships copy, templates, calculations or data handling to a
real user waits for the gate's answer on that item. If a task looks like it
crosses that line, ask.

The product's plan fills in: the name of the gate issue and what it covers.

## Guardrails — product-wide, and load-bearing

These come from the plan's decisions and MMFF-App's shared conventions. Breaking
one is a legal or security problem, not a style problem.

**Sensitive data:**

MMFF-App sorts every piece of data into one of three classes. The
product's plan fills in the lists and names the issue that builds the controls;
this is the framework.

- **Prohibited data is never stored anywhere.** It is the product's list of
  government identification numbers, passwords and payment-card numbers.
  - It never goes into the database, logs, error reports, analytics, queue or
    job payloads, URLs, emails, R2, or any stored document.
  - It passes through a server-only path straight to the provider that needs
    it, or into a response rendered on request and streamed without being
    persisted.
  - The product stores instead, where it needs a trace, a truncated form (such
    as the last four digits), a timestamp and the provider's reference. A
    truncated form is itself restricted data.
  - **Card data always stays with Stripe.** The product never stores card or
    bank-account numbers.
  - The product's plan fills in: the full list of prohibited items.
- **Restricted data is stored only under the restricted-data controls.** It is
  every other sensitive item the product keeps: personal details of the people
  it serves, regulated records, documents copied from providers,
  identity-verification results, the access audit log itself, and payment
  details beyond what Stripe returns. The product's plan fills in the full list.
- **Ordinary data** is everything else (account settings, order status,
  preferences). It is still under account-scoped row-level security.
- **The restricted-data controls:**
  1. **Access:** row-level security scoped by account on every table;
     cross-account access only through a typed grant table (see "Data and
     access").
  2. **Encryption:** encrypted at rest, with application-layer (envelope)
     encryption on top of Neon's disk encryption for the most sensitive
     columns the plan names. Documents sit in private R2 buckets.
  3. **Serving:** documents are served only through the product's short-lived
     signed links, never a provider URL or a public link.
  4. **Audit:** every read of a restricted record, or download of a restricted
     document, is written to the access audit log.
  5. **Where it never goes:** logs, error reports, analytics events, queue or
     job payloads (which carry IDs only), URLs or email bodies.
  6. **No marketing or cross-product use** of restricted data unless the plan
     names the consent that allows it.
  7. **Retention:** kept no longer than the period counsel sets.
- Log redaction is not optional. If you add a logger, a new field, or an error
  path that can carry request bodies, check it against the plan's
  "appears nowhere" test for prohibited data.

**Test data:**

- **Never use real personal data,** or a value copied from any real document or
  account: not in a test, fixture, seed, log, issue, commit, prompt or chat.
- **Against a vendor's sandbox,** use only the test values that vendor
  documents. An M0 issue confirms them.
- **Against the product's fake provider, and in every test that does not reach
  a vendor,** generate a **fresh value on every run**, in a pattern that cannot
  belong to a real person (for example, a number range the issuing authority
  never assigns, or an address on a reserved test domain). The product's plan
  fills in the pattern for each identifier it handles.
- **Never hard-code a full identification number** in a fixture, seed or
  snapshot. A failing assertion prints only a truncated form.
- The product's validators must accept its test pattern outside production.

**Providers:**

- Every vendor sits behind an adapter interface the product defines. **Never
  call a vendor SDK or endpoint from a screen, a route handler or a wizard
  directly.** Swapping a vendor must be a data change in a routing table.
  The product's plan fills in the interface names.
- **Screens contain no per-jurisdiction or per-vendor code.** Behaviour that
  varies that way lives in a rules layer in the database, each rule carrying a
  source link and a last-verified date.
- Provider webhooks are verified by signature, written raw to a
  `provider_events` table unique on the provider's event ID, and processed by a
  job. Never trust an unsigned event, and never update a record's status from
  anything but the product's own tables.
- Provider documents arrive as time-limited URLs; copy them into R2 and serve
  the product's own signed links.

**Money:**

- **Money is integer cents.** No floats in fees, prices or calculations. Rates,
  where they appear, are integer basis points.
- **Nothing is submitted to a provider before payment succeeds.**
- Where the product touches money that is not its own fee, it handles it only
  in the way counsel approves.

**Data and access:**

- **Row-level security on every table, scoped by account.** A new table without
  an RLS policy and a test that acts as a second account and sees nothing is
  not done.
- **Cross-account access exists only through a typed grant table.** A grant
  table carries the owner account's ID on every row, so its own policy never
  reads the shared table. The shared table gets a second, SELECT-only,
  permissive policy scoped `TO authenticated` that calls a SECURITY DEFINER
  helper with `search_path = ''` in a non-exposed `private` schema. The RLS test
  harness supports at least three accounts (owner, grantee and unrelated), and
  the unrelated account must see nothing. Signed-link minting enforces the same
  grant server-side.
- MMFF-App has **its own Neon project**. **No shared database** with any
  other product. Cross-product links are user-initiated.
- Reach Neon, Stripe, R2 and Resend through **environment variables, never
  a hard-coded project reference or key**.

**Dates:**

- The hard dates in the plan **do not move. If a milestone slips, cut scope
  inside it.** The product's plan fills in the dates.

## Traps that cost real time

**Read `docs/trapstoknow.md` before you start work and before you debug a build, a test or a
screen.** It lists the mistakes that look fine, often pass the gate, and fail
somewhere else — the stack-wide ones first, then this repository's own. Add a new trap there, not here.

## Develop and test locally, not on Vercel

Vercel build minutes are metered and a deploy is not a test environment. Run the
app and its gates on this machine or a Claude Code cloud container. Never push
just to see a deploy, and **never run migrations against a live project from a
dev session**. Use Stripe **test mode** and each provider's **sandbox** for all
development.

## Where outstanding work goes

**The GitHub issue tracker in this repository**, and nowhere else. Keep the
codebase free of `TODO`/`FIXME` markers: if you defer something, file an issue
against the right milestone. Each milestone has an epic issue, and each plan
entry's issue is a sub-issue of its milestone's epic.

## Writing voice for anything published to GitHub

**Milestones, issues, commits, PRs and comments are written to educate.** Assume
the reader does not have the full context — a new contributor, a future
maintainer, or the same person six months from now who has forgotten why.

- **Say why before what.** The reason a piece of work exists goes stale slowest
  and is the hardest thing to reconstruct later.
- **Define the terms and name the files.** Spell out project jargon on first use
  and point at real paths, tables and plan sections so the reader can go look.
- **State what breaks if it is skipped**, and what "done" actually looks like.
- **Show the reasoning, including what was rejected.** A decision recorded
  without its alternatives gets re-litigated.
- **Write prose, not fragments.** Full sentences, no bare ticket references.

The bar: someone who has never seen this codebase should be able to read the
issue and understand both the task and why it matters.

## Writing readable code

A person reads, reviews and changes everything you write. Write for them.

**Comments say what, briefly. Long explanations go elsewhere.**
- At the top of a file: one or two lines saying why the file exists. It is
  not a manual. Usage, environment variables and edge cases go next to the
  code they concern, or in `docs/`.
- Above each block of code: a short comment saying what the block does
  ("Refuse a role that bypasses RLS"). Do not narrate how the language works
  or restate the next line.
- A reason belongs in a comment only where the code cannot show it, such as
  a vendor quirk, a security rule or a trap. Keep it to one or two lines, at
  that spot. Longer reasoning goes in the commit message, the issue or
  `docs/trapstoknow.md`.

**Structure keeps the main path obvious.**
- Keep nesting shallow. Return early on guard conditions (invert the `if`),
  so the main path runs at the left margin. Code more than two levels deep
  is a function waiting to be extracted.
- Extract named functions for complex conditions and for each step of a long
  function, so the top-level function reads as a summary of what happens.
- Merge related checks into one place, for example all environment checks
  in one `readConfig()`.
- Never duplicate logic. Two copies of a rule drift apart; write one
  function and call it from both places.
- Name things for what they hold or do. No one-letter names outside a tiny
  callback: `role`, `loan` and `report`, not `r`, `l` and `c`.

The shape to aim for, from `apps/app/scripts/rotate-token-key.ts`:

```ts
/** Re-encrypts stored Plaid tokens under the newest TOKEN_ENC_KEY version so the old key can be retired. */

async function main(): Promise<number> {
  const config = readConfig();
  if (!config.ok) return refuse(config.reason);

  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    // The app never connects as a role that bypasses RLS; neither may this script.
    if (await bypassesRls(pool)) {
      return refuse("Refusing to run: DATABASE_URL must be the restricted mmff_app role, not an owner role.");
    }

    printPlan(config.apply, config.targetVersion);
    const counts = await rotateAll(ownerScoped(pool), await ownerIds(pool), process.env, config.apply);
    return printReport(counts, config.apply);
  } finally {
    await pool.end();
  }
}
```

## Guardrails — ask before proceeding

Never do the following without explicit human confirmation, even if the
task description seems to imply it or a script/tool makes it easy:

### Version control
- Force-pushing to any branch, especially `main`/`master`/`develop`
- Rewriting shared history (rebase, amend, filter-branch) on a pushed branch
- Deleting branches or tags
- Committing directly to protected branches instead of opening a PR
- Merging your own PR

### Destructive / irreversible operations
- `rm -rf`, bulk file deletion, or deleting anything you didn't create this session
- Dropping or truncating database tables, dropping a database
- Running migrations against a non-local database (staging/prod)
- Deleting cloud resources (S3 buckets, VMs, DNS records, load balancers, etc.)
- Overwriting existing files with generated content instead of diffing/patching

### Security & secrets
- Committing API keys, tokens, passwords, or `.env` files
- Adding new third-party dependencies without checking their maintenance/security posture
- Disabling auth checks, CORS restrictions, or security middleware "to make it work"
- Changing permissions/IAM roles/access policies

### Environment & infra
- Modifying CI/CD pipelines, deploy scripts, or infra-as-code (Terraform, etc.)
- Changing environment variables in staging/production
- Deploying to production
- Upgrading major versions of core dependencies (framework, language, DB driver)
- Changing package manager lockfiles in ways that shift many transitive deps

### Product-specific
- Switching any provider from sandbox or test mode to live mode
- Submitting a real transaction or filing
- Sending email to anyone who is not a test address you control
- Changing legal copy, disclosures or counsel-approved templates

### Quality gates
- Skipping, deleting, or weakening tests to make a build pass
- Disabling linters/type-checkers instead of fixing the underlying issue
- Merging with failing CI
- Suppressing errors/exceptions with broad catch-alls instead of handling them

### Scope
- Refactors that touch more than a handful of unrelated files
- Changing public APIs / function signatures other code depends on
- Renaming or moving files/directories that other tooling may reference

## General behavior
- Prefer the smallest diff that solves the problem.
- If a task requires one of the above, stop, explain what you want to do and
  why, and wait for a yes before doing it — don't do a "dry run" that quietly
  performs the action.
- If instructions are ambiguous and the ambiguity affects something in the
  list above, ask rather than guessing.
- Always run the existing test suite (or relevant subset) before declaring a
  change done.
- State assumptions explicitly when you make them.
