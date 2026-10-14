# Local development

Run everything on this machine. Never push just to see a deploy: Vercel build
minutes are metered.

## Requirements
Node 22 or newer (`.nvmrc`), pnpm 10 (`packageManager` in the root
`package.json`).

## Commands
```bash
pnpm install
pnpm dev          # Next.js app on http://localhost:3100
```

The gate, run before declaring any change done:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Pipe long output through `2>&1 | tail -n 60` when an agent runs it.

## Environment
Copy `apps/app/.env.example` to `apps/app/.env.local` and fill it in. Real
values never go in the repository, a log, an issue or a chat. Use Plaid's
**sandbox** and the Neon `vercel-dev` branch for development. Never run
migrations against the `production` branch from a dev session.

## Database and auth in development
The tests need no cloud. Vitest's global setup applies
`apps/app/db/migrations/*.sql` to PGlite (in-process Postgres) once per run.
Every database test then loads its own copy of the result, and
`src/server/db/rls.test.ts` proves the row-level security rules on it.

To run the app against real data you need, in `apps/app/.env.local`:
`DATABASE_URL` (the pooled string of the `mmff_app` role on your dev branch),
`NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `OWNER_EMAIL` and
`TOKEN_ENC_KEY`. Applying migrations to the dev branch is described in
`setup/02-neon-database.md`; generating keys in `setup/05-secrets-and-security.md`.
Without the auth variables the app fails closed: every route redirects to
`/auth/sign-in`, which says sign-in is not configured.

## Linked services
Each person runs their own: a Neon project (with a production branch and a
separate dev branch), a Vercel project whose Root Directory is `apps/app`, and
a Plaid team. Setup is in `setup/README.md`. Confirm Plaid Trial limits and
OAuth-bank support in the Plaid dashboard before relying on real institutions.

## Linking against Plaid sandbox (M3)
Add to `apps/app/.env.local`: `PLAID_CLIENT_ID`, `PLAID_SECRET` (your Sandbox
secret) and `PLAID_ENV=sandbox`. `PLAID_WEBHOOK_URL` can stay empty until M4
(webhooks cannot reach localhost). Leave `MMFF_ALLOW_PLAID_PRODUCTION` unset.
With the database and auth variables above also set, run `pnpm dev`, sign in,
open My Institutions and use "+ Link an institution". In Plaid Link pick First
Platypus Bank and sign in with Plaid's documented sandbox test credentials only
(see `setup/03-plaid.md`). The tests need none of this: they inject fake Plaid
clients and run against PGlite.

## Sync, webhooks and the snapshot (M4)
Migration `0004_sync.sql` must be applied to your dev branch (direct string, as
the project owner role). New env names: `CRON_SECRET` and optional
`OWNER_TIMEZONE`. The tests need none of it: `src/server/sync` and
`src/server/webhooks` tests run the real migrations on PGlite with an injected
fake Plaid provider, and generate a throwaway ES256 key to sign test webhooks.

On localhost Plaid cannot reach you, so webhooks are exercised on a Vercel
Preview (see `setup/03-plaid.md`). Locally, as the signed-in owner,
`POST /api/plaid/items/<id>/sync` runs the same ingest, and
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/snapshot`
runs the snapshot (Vercel does not run cron under `pnpm dev`).
