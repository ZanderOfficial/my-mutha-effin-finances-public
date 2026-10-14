# 07. Troubleshooting

Only problems grounded in this repository or in the vendors' documentation are
listed. If yours is not here, read `docs/trapstoknow.md` next.

## `pnpm install` or the build fails right away

Cause: wrong Node or pnpm. The root `package.json` requires Node `>=22` and
pins `pnpm@10.34.4`; `.nvmrc` records the Node line.

```bash
node --version
```

Fix: install Node 22 or newer (for example with `nvm use` if you use nvm) and
pnpm 10, then reinstall. On Vercel, set Node to 22.x in Project Settings.

## The app shows no data

This is expected today. No Plaid or Neon code exists yet, and the project never
invents figures: every screen is blank with dashes or `0.00`
(`docs/trapstoknow.md`).

## My `.env.local` values are ignored

- The file must be `apps/app/.env.local`, next to `apps/app/package.json`, not
  the repository root.
- Restart `pnpm dev` after editing it; Next.js reads env files at start.
- Today the app reads none of these variables, so nothing visibly changes.

## Build warning or error about fonts

The font family in `next/font` is `Big_Shoulders`. Google Fonts renamed it, and
`Big_Shoulders_Display` no longer exists (`docs/trapstoknow.md`). Use the new
name.
## The repo wants `middleware.ts`

Next.js 16 renamed it to `proxy.ts`. Read
`apps/app/node_modules/next/dist/docs/` before writing framework code.

## Plaid webhook never arrives (after M4)

- The URL must be public, valid HTTPS. `localhost` cannot receive webhooks
  (https://plaid.com/docs/api/webhooks/).
- Check `PLAID_WEBHOOK_URL` is the one passed to `/link/token/create`.
- Plaid retries for up to 24 hours if you return non-200 or take over 10
  seconds. Return quickly and process the event in a job. Read the raw body
  before parsing, or signature verification fails (`docs/trapstoknow.md`).
- In Sandbox, trigger one on demand with `/sandbox/item/fire_webhook`.

## Cron did not fire, or fired late

- On Hobby, a daily job may run anywhere within its hour, and delivery is best
  effort and can repeat (https://vercel.com/docs/cron-jobs/usage-and-pricing and
  https://vercel.com/docs/cron-jobs/manage-cron-jobs). The app's snapshot is
  designed to be idempotent and show a stale badge.
- A cron expression that runs more than once a day fails the Hobby deployment.
- Vercel does not retry a failed cron call. Check the Cron Jobs settings page
  and its View Logs link.
- A route that returns a redirect is treated as finished, and `CRON_SECRET`
  mismatch should return 401.

## Neon connection errors

- Using a pooled string for migrations or `pg_dump` fails on session features;
  use the direct string (no `-pooler`)
  (https://neon.com/docs/connect/connection-pooling).
- If you use an IP allow list, the MCP server needs Neon's published addresses
  allowed (https://neon.com/docs/ai/neon-mcp-server).
- A copied string with a stray space, quote or line break is the most common
  cause of an authentication error; paste it again.

## MCP server shows "needs authentication"

Run `/mcp` in Claude Code and complete the browser sign-in. The Plaid
Dashboard server's tokens expire after 15 minutes
(https://plaid.com/docs/resources/mcp/).
