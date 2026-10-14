# Install your own copy of MMFF-App

MMFF-App is a personal net worth and spending tracker. It is built so that each
person runs their own copy: their own database, their own hosting account and
their own bank-data account. Nobody, including the original developer, hosts or
holds anyone else's financial data. This folder walks you (or an AI coding
agent working for you) through that install.

Read the "Open source and your responsibility" section at the top of the root
`README.md` first. By installing this app you accept it.

> A license file is pending. The repository does not yet name a license, so do
> not assume any particular reuse terms until the owner adds a `LICENSE` file.

## Read this first: what works today

Milestones M1 to M6 are built (see `docs/plan/IMPLEMENTATION-PLAN.md`, Status).
With nothing linked every screen is blank by design: dashes, never invented
figures. To see real data you need your own Neon, Plaid and Vercel accounts.

| Piece | State |
| --- | --- |
| Next.js 16 app, five screens, the lint, typecheck, test and build gate | Built |
| Neon Postgres, migrations 0001 to 0004, row-level security, `mmff_app` role | Built; you apply the migrations by hand |
| Single-owner sign-in (Neon Auth) and token encryption | Built; you set the variables |
| Plaid Link, exchange, accounts and balances, reconnect, unlink | Built; Sandbox first |
| Transaction sync, signed webhook route, daily cron snapshot | Built |
| Screens reading real data, budget limits | Built |
| Security headers, log redaction, accessibility pass | Built |
| Going live | Yours to do: follow `docs/LAUNCH.md` |

## Order to follow

1. [01 Fork and run locally](01-fork-and-run-locally.md): the only step you need
   for the app as it exists today.
2. [02 Neon database](02-neon-database.md)
3. [03 Plaid](03-plaid.md)
4. [04 Vercel](04-vercel.md)
5. [05 Secrets and security](05-secrets-and-security.md): read before you create
   any key, not after.
6. [06 MCP servers](06-mcp-servers.md): lets an AI agent do steps 2 to 4 with you.
7. [07 Troubleshooting](07-troubleshooting.md)

## How the pieces fit

```
  You (browser, phone)
        |
        v
  Vercel  ---- hosts the Next.js app (apps/app) and runs Vercel Cron daily
     |  \
     |   \--> Neon Postgres   (planned: balances, transactions, encrypted tokens)
     |
     +------> Plaid API       (planned: Link, transactions, liabilities, investments)
                 |
                 +--> webhook, public HTTPS --> Vercel  /api/webhooks/plaid (planned)
```

Plaid can only send webhooks to a public HTTPS address, which is why the running
copy lives on Vercel while development happens on your own machine.

## Prerequisites

- A GitHub account (to fork) and `git`.
- Node 22 or newer. The repo pins it in `.nvmrc`.
- pnpm 10. The root `package.json` pins `pnpm@10.34.4` through `packageManager`.
- Accounts you create yourself: Neon, Vercel, Plaid. Each vendor sets its own
  pricing and free limits; check each pricing page yourself.
- Optional: Claude Code or another MCP-capable agent (see step 6).

## Ground rules that apply to every step

- Use Plaid Sandbox and a Neon development branch until the app is finished.
- Never paste real keys, tokens or bank data into a chat, issue, commit or test.
- Never run migrations against your production database from a development
  session.
