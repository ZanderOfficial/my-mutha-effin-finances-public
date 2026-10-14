# 01. Fork and run locally

Why: running locally is free, fast and safe. Vercel build minutes are metered,
so the project's rule (see `AGENTS.md`) is to prove everything on your own
machine and never push just to see a deploy.

## Steps

1. Fork the repository on GitHub, then clone your fork.

```bash
git clone https://github.com/<your-account>/<your-fork>.git
```

2. Enter the folder.

```bash
cd <your-fork>
```

3. Check your Node version. It must print v22 or higher.

```bash
node --version
```

4. Check pnpm. It must be 10.x. If it is missing, install it from pnpm.io (or
   enable Corepack if your Node install includes it) so that the version pinned
   in the root `package.json` is used.

```bash
pnpm --version
```

5. Install dependencies.

```bash
pnpm install
```

6. Create your local env file. `.env.local` is already ignored by git
   (`.gitignore` ignores `.env*` except `.env.example`).

```bash
cp apps/app/.env.example apps/app/.env.local
```

   Leave the values empty for now. Today nothing in the app reads them. The
   variables, from `apps/app/.env.example`, are `DATABASE_URL`,
   `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (defaults to `sandbox`),
   `PLAID_WEBHOOK_URL`, `TOKEN_ENC_KEY` and `CRON_SECRET`. Steps 02, 03 and 05
   explain each one.

7. Run the gate. It must pass before you change or deploy anything.

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

8. Start the app. It serves on port 3100 (set in `apps/app/package.json`).

```bash
pnpm dev
```

9. Open http://localhost:3100. You should see the app shell with five tabs and
   blank screens. That is correct, not a bug: the project never invents
   financial figures (`docs/trapstoknow.md`).

## If something fails

See [07 Troubleshooting](07-troubleshooting.md). Next.js 16 changed several
conventions (for example `middleware.ts` is now `proxy.ts`), so read
`apps/app/node_modules/next/dist/docs/` before writing framework code.
