# My Mutha Effin Finance App (MMFF-App)

## Open source and your responsibility

This project is open source. The developer does not host or hold anyone else's
financial data: each person runs their own copy, with their own Neon database,
their own Vercel account and their own Plaid account.

- What you do with this app, and what you do with your own data inside it, is
  entirely your responsibility.
- The software is provided as is, with no warranty of any kind.
- Nothing here is financial, tax or legal advice.
- Keep your own keys, tokens and connection strings secret. Never commit them.

To install your own copy, start at [`setup/README.md`](setup/README.md).

A personal net worth and spending tracker. MMFF-App pulls bank, credit card and
brokerage data through [Plaid](https://plaid.com) and turns it into one daily
net-worth time series plus a searchable spending history.

## Why it is hosted, not local

MMFF-App deploys on Vercel rather than running as a desktop app. Plaid sends
webhooks (notifications that new data is ready) to a public HTTPS URL, and
`localhost` cannot receive them. Local development still happens on this
machine; only the running instance lives on Vercel. See `docs/LOCAL-DEV.md`.

## Data layer

Vercel functions have no persistent storage, so state lives in serverless
Postgres (Neon, per `AGENTS.md`). It holds:

- linked Plaid Items and their access tokens (encrypted),
- daily account balance snapshots,
- transactions,
- investment holdings.

## Plaid products

| Product | What MMFF-App uses it for |
| --- | --- |
| Transactions | Spending history, up to 24 months |
| Liabilities | Credit card balances and due dates |
| Investments | Brokerage holdings and transactions |

## Core flow

1. The Plaid Link widget on the frontend connects an account.
2. The server stores the resulting `access_token` for that Item in the database.
3. `/api/webhooks/plaid` receives Plaid's update notifications.
4. A scheduled Vercel Cron job pulls fresh balances and transactions.
5. Each day, net worth is computed as sum(assets) − sum(liabilities) and stored
   as a time series.

## Cost

Plaid offers a Trial plan with a small number of live Items and paid plans
above it. Limits and prices change, so check Plaid's billing page before you
rely on any of them.

## Repository guide

- `setup/README.md` — install your own copy (Neon, Vercel, Plaid, MCP servers).
- `docs/LAUNCH.md` — the owner's ordered checklist from a dev branch to a live
  deployment, with verification, rollback and key rotation.
- `docs/LOCAL-DEV.md` — run the app and the gate on your machine.
- `migrations/` — the record of which database migrations were applied where.
- `AGENTS.md` — the rules every contributor and agent follows.
- `CLAUDE.md` — session start-up instructions for Claude Code.
- `CONTRIBUTING.md` — the gate, the no real data rule and how to send a change.
- `SECURITY.md` — how to report a vulnerability privately.
- `DESIGN.md` and `PRODUCT.md` — the design system and what the product is for.
- `docs/trapstoknow.md` — mistakes that pass the gate and fail elsewhere.
- `docs/plan/IMPLEMENTATION-PLAN.md` — the plan; its Status section says what
  is built and what waits on the owner.

## Development

Run the gate locally, never on Vercel:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Use Plaid's sandbox and never paste real account data into tests, fixtures or
logs.
