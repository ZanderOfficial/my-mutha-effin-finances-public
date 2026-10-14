# 04. Vercel

Why: Plaid must reach a public HTTPS URL, and Vercel functions cannot hold
state, so the running copy of the app lives on Vercel with its data in Neon.

State today: you can deploy the scaffold and see the blank screens. There is
the cron and webhook routes exist as of M4.

## Steps

1. Create a Vercel account and import your fork of the repository from GitHub
   (Add New, Project).

2. Set the Root Directory to `apps/app`. The Next.js app lives there, in a
   Turborepo and pnpm monorepo. Leave the framework preset on Next.js, which
   Vercel detects. Vercel reads the pnpm version from `packageManager` in the
   root `package.json`; if the build complains, check Node is set to 22.x in
   Project Settings, General.

3. Do not trigger deployments just to test. Run the gate locally first
   (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`). Builds cost
   metered minutes on some plans.

4. Add environment variables in Project Settings, Environment Variables. Vercel
   has three environments (Production, Preview, Development), and each variable
   is scoped to the ones you tick.

| Variable | Production | Preview | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | production Neon branch | dev Neon branch | secret |
| `PLAID_CLIENT_ID` | your client_id | same | secret |
| `PLAID_SECRET` | Production secret, only when you go live | Sandbox secret | secret |
| `PLAID_ENV` | `sandbox` until you choose `production` | `sandbox` | switching is human-only |
| `PLAID_WEBHOOK_URL` | `https://<your-domain>/api/webhooks/plaid` | the preview URL | route live (M4) |
| `TOKEN_ENC_KEY` | generated, see step 05 | a different one | secret, never reuse |
| `CRON_SECRET` | generated, see step 05 | not needed | secret, cron fails closed without it |
| `OWNER_TIMEZONE` | e.g. `America/Chicago` (optional, default UTC) | same | not a secret |

   Mark secrets as Sensitive where Vercel offers it. Do not paste secret
   values into a chat with an AI agent.

5. Connect Neon. The Vercel-managed Neon integration provisions a database
   from the Vercel Marketplace, injects `DATABASE_URL` (pooled) and
   `DATABASE_URL_UNPOOLED` (direct), and can create a database branch for each
   preview deployment (https://neon.com/docs/guides/vercel-managed-integration).
   Neon notes you cannot combine it with the Neon-managed integration in the
   same project. Alternatively set `DATABASE_URL` by hand as above. Either
   way, make sure Production and Preview point at different branches.

## Cron (built in M4)

`apps/app/vercel.json` (the project Root Directory is `apps/app`) declares one
daily cron, `GET /api/cron/snapshot` at `0 9 * * *` (UTC). It refreshes cached
balances, writes one `balance_snapshots` row per account and one
`net_worth_daily` row dated in `OWNER_TIMEZONE` (default UTC; set an IANA name
such as `America/Chicago`). Reruns overwrite the same day, so a duplicate or
late delivery is harmless. On the free Hobby plan, per Vercel
(https://vercel.com/docs/cron-jobs/usage-and-pricing):

- A cron job can run at most once per day; a faster expression fails the
  deployment.
- Timing is imprecise: a job set for `0 1 * * *` can fire any time between 1:00
  and 1:59. The plan therefore requires the snapshot to be idempotent and the
  screens to show a stale badge.

Vercel secures cron calls with `CRON_SECRET`: if the variable exists, Vercel
sends it as `Authorization: Bearer <value>` and your route must compare it and
return 401 on mismatch
(https://vercel.com/docs/cron-jobs/manage-cron-jobs). The same page says
delivery is best effort and may repeat, and that cron jobs are not supported
by `next dev`; you test a cron route locally by requesting its URL yourself.

Set `CRON_SECRET` (step 05) in Production and Preview. With it unset the route
answers 401 to everyone: it fails closed, so the snapshot never runs until the
variable exists. Because the job can fire up to an hour late, a snapshot date
is decided when it runs, and the screens must show a stale badge from
`balance_updated_at` rather than assume the data is fresh.

To test by hand, request the URL yourself with the header
`Authorization: Bearer <CRON_SECRET>` (cron is not run by `next dev`).

## After the first deploy

1. Open the Production URL and confirm the blank screens render.
2. Set `PLAID_WEBHOOK_URL` to your real domain once it is final.
3. Keep Plaid on Sandbox until you have read step 05.

## MCP

An agent can read deployments and logs through Vercel's MCP server; see
[06 MCP servers](06-mcp-servers.md).
