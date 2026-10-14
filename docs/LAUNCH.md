# Launch runbook

This is the ordered checklist for taking MMFF-App from an empty Neon dev branch
to your own production deployment with real banks linked. It is written for the
owner. An agent can do the code and the tests; it cannot (and by the rules in
`AGENTS.md` must not) sign vendor contracts, switch Plaid to live mode, apply
migrations to production or deploy.

Why a runbook at all: every step below has a failure mode that looks like
success. A database role that bypasses row-level security "works"; a Plaid
secret in the wrong environment links the wrong kind of bank; a webhook URL set
after linking is silently ignored. The order and the checks are there to catch
those before real money data is involved.

**Steps marked `OWNER ONLY` need your accounts, your money or your judgement.**
Everything else you can do by hand or hand to an agent, but never paste a secret
value into a chat with one.

Conventions: shell variables such as `MIGRATE_URL` are set in your own terminal
for the session and never written to a file in the repository. Run one command
per block, read the output, then move on.

## Part 1. Dev branch: prove it works with fake banks

Plaid Sandbox and a Neon dev branch cost nothing and hold no real data. Do all
of Part 1 before touching production.

### 1. Create a clean Neon dev branch (OWNER ONLY)

Why: migrations are forward-only (there are no down scripts), so you want to
rehearse them on a branch you can throw away.

1. In the Neon Console, create a branch from the root branch and name it
   `vercel-dev` (the name used in `docs/LOCAL-DEV.md`).
2. Copy that branch's **direct** connection string (no `-pooler` in the host)
   for the project owner role.
3. In your terminal, keep it in a variable for this session only:

```bash
read -rs MIGRATE_URL && export MIGRATE_URL
```

### 2. Apply migrations 0001 to 0004 over the direct connection (OWNER ONLY)

Why: the pooled string is PgBouncer in transaction mode and cannot run session
features; and migration `0004` creates `SECURITY DEFINER` functions that must be
owned by a role that can bypass row-level security, which on Neon is the project
owner role. Never run these against `production` from a development session.

1. Check you are on the dev branch, not production. This must print the branch's
   database and say nothing about production data:

```bash
psql "$MIGRATE_URL" -c "select current_database(), current_user"
```

2. Apply the four files in order, stopping at the first error:

```bash
for f in apps/app/db/migrations/0001_schema.sql apps/app/db/migrations/0002_rls.sql apps/app/db/migrations/0003_runtime_role.sql apps/app/db/migrations/0004_sync.sql; do psql "$MIGRATE_URL" -v ON_ERROR_STOP=1 -f "$f" || break; done
```

3. Confirm every public table has row-level security forced:

```bash
psql "$MIGRATE_URL" -c "select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by relname"
```

   Every row must show `t` and `t`.

### 3. Give `mmff_app` a password and build `DATABASE_URL` (OWNER ONLY)

Why: Neon's default roles bypass row-level security, so an app connected as one
ignores every policy and still looks fine. `mmff_app` is created without that
power by `0003`; it has no password until you set one.

1. Generate a password (hex, so it is safe inside a connection string):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

2. Put it in a shell variable without echoing it, then set it on the role:

```bash
read -rs MMFF_APP_PASSWORD && export MMFF_APP_PASSWORD
```

```bash
psql "$MIGRATE_URL" -v ON_ERROR_STOP=1 -c "ALTER ROLE mmff_app PASSWORD '$MMFF_APP_PASSWORD'"
```

3. Build the app's string from Neon's **pooled** host (it contains `-pooler`),
   user `mmff_app` and that password, and use it as `DATABASE_URL`. Check it is
   restricted; the answer must be `f | f`:

```bash
psql "$DATABASE_URL" -c "select rolbypassrls, rolsuper from pg_roles where rolname = current_user"
```

### 4. Neon Auth and the owner (OWNER ONLY)

Why: the app has one owner. Auth fails closed, so a missing value gives blank
screens and a sign-in page rather than someone else's data. But signing in is
not the same as being the owner: only the `OWNER_EMAIL` account is, so public
sign-up must be closed once your account exists.

1. In the Neon Console, enable Auth on the dev branch and create your user
   (email and password).
2. Copy the Auth URL into `NEON_AUTH_BASE_URL`.
3. Generate `NEON_AUTH_COOKIE_SECRET` (at least 32 characters):

```bash
openssl rand -base64 32
```

4. Set `OWNER_EMAIL` to the address of that user, and `OWNER_TIMEZONE` to your
   IANA zone (for example `America/Chicago`). The timezone decides which day a
   snapshot is dated and when "this month" starts; Vercel runs in UTC, so
   leaving it unset puts you a day off around midnight.
5. In the Auth settings, turn public sign-up off. Verify by trying to register
   a second address in a private window; it must be refused.

### 5. Generate `TOKEN_ENC_KEY` and `CRON_SECRET`

Why: `TOKEN_ENC_KEY` encrypts every Plaid access token at rest (AES-256-GCM, 32
random bytes, base64). `CRON_SECRET` is what Vercel Cron sends to prove a
snapshot request is real; with it unset the cron route answers 401 to everyone.
Use a different value for each variable and for each environment.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run it once per value. Paste straight into `apps/app/.env.local` and later into
Vercel; never into a chat, an issue or a commit.

### 6. Run the app locally against Plaid Sandbox

Why: this proves auth, the database role, encryption and the Link flow with
Plaid's fake bank before anything is deployed. Set `PLAID_CLIENT_ID`,
`PLAID_SECRET` (Sandbox) and `PLAID_ENV=sandbox` in `apps/app/.env.local` and
leave `MMFF_ALLOW_PLAID_PRODUCTION` unset.

```bash
pnpm dev
```

Sign in, open My Institutions, link First Platypus Bank with Plaid's documented
test login from `setup/03-plaid.md`, and check the verification list in Part 4.

### 7. Create the Vercel project (OWNER ONLY)

Why: Plaid can only send webhooks to a public HTTPS address, and cron lives on
Vercel.

1. Import the repository in Vercel. Set **Root Directory to `apps/app`** and
   Node to 22.x. Do not deploy "just to see".
2. Add environment variables per environment (Project Settings, Environment
   Variables). Mark secrets Sensitive.

| Variable | Preview | Production |
| --- | --- | --- |
| `DATABASE_URL` | pooled `mmff_app` string, dev branch | pooled `mmff_app` string, production branch |
| `NEON_AUTH_BASE_URL` | dev branch Auth URL | production branch Auth URL |
| `NEON_AUTH_COOKIE_SECRET` | its own value | its own value |
| `OWNER_EMAIL` | your address | your address |
| `OWNER_TIMEZONE` | your IANA zone | your IANA zone |
| `TOKEN_ENC_KEY` | its own value | its own value, never reused |
| `CRON_SECRET` | its own value | its own value |
| `PLAID_CLIENT_ID` | your client id | same |
| `PLAID_SECRET` | Sandbox secret | Sandbox secret until step 13 |
| `PLAID_ENV` | `sandbox` | `sandbox` until step 13 |
| `PLAID_WEBHOOK_URL` | preview URL + `/api/webhooks/plaid` | production URL + `/api/webhooks/plaid` |
| `PLAID_REDIRECT_URI` | preview URL + `/oauth/plaid` | production URL + `/oauth/plaid` |
| `MMFF_ALLOW_PLAID_PRODUCTION` | unset | unset until step 13 |

   Production and Preview must point at different Neon branches.

### 8. Preview deploy with Plaid Sandbox (OWNER ONLY)

Why: webhooks cannot reach localhost, so this is the first time the signed
webhook path is exercised for real, and the first time the security headers and
content security policy run behind HTTPS.

1. Push your branch and let Vercel build a Preview.
2. Open it, sign in, and link First Platypus Bank. The webhook URL is attached
   to an Item when its Link token is created, so link **after**
   `PLAID_WEBHOOK_URL` is set; to fix an older Item, unlink and relink it.
3. Plaid sends `SYNC_UPDATES_AVAILABLE` once the first pull is ready. Within a
   minute transactions should appear on Transactions and Overview.
4. Open the browser console on every screen. There must be no
   "Refused to load" or "violates the following Content Security Policy" lines.
   If Plaid Link fails to open, that is the first place to look.
5. Check the response headers on the preview URL:

```bash
curl -sI https://<your-preview-domain>/auth/sign-in
```

   Expect `content-security-policy`, `strict-transport-security`,
   `x-content-type-options: nosniff`, `x-frame-options: DENY`,
   `referrer-policy` and `permissions-policy`.

6. Run the daily snapshot by hand once (the secret is read from your shell, not
   typed into the command):

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<your-preview-domain>/api/cron/snapshot
```

   The answer is counts only, for example `{"owners":1,"succeeded":1,...}`.

## Part 2. Production database and deploy

### 9. Production Neon branch (OWNER ONLY)

1. Take a snapshot or create a backup branch of the (still empty) production
   branch first; it is your rollback point for the migrations.
2. Repeat steps 2 and 3 against the **production** branch's direct string. Use a
   new `mmff_app` password; never reuse the dev one.
3. Repeat step 4 for the production branch's Auth, including closing sign-up.

### 10. Production deploy, still on Sandbox (OWNER ONLY)

Why: prove production configuration with fake banks before real ones.

1. Merge the reviewed pull request to `main`; Vercel deploys Production.
2. Sign in on the production URL and link First Platypus Bank. Check the
   verification list in Part 4.
3. Unlink the sandbox Item before step 13 so nothing fake remains.

## Part 3. Going live with real banks (OWNER ONLY)

### 11. Plaid production access and OAuth registration (OWNER ONLY)

Why: Production keys are a different secret, and large US banks use OAuth,
which Plaid only enables after you complete its compliance registration.

1. In the Plaid Dashboard confirm your plan, the Trial limit on Production
   Items, and whether Production access is granted or must be requested
   (`setup/03-plaid.md` explains what is uncertain). Removing a Trial Item does
   not give the allowance back.
2. For OAuth institutions, complete the registration in the Dashboard
   (application details, company details, agreement, security questionnaire)
   and wait for approval. Without it, those banks will not appear in Link.
3. **Register the redirect URI.** In the Plaid Dashboard open the API page,
   find "Allowed redirect URIs" and add the production address of the return
   page, exactly `https://<your-production-domain>/oauth/plaid` (no query
   string, no trailing slash). Plaid refuses a Link token whose `redirect_uri`
   is not on this list, so an OAuth bank fails to open until it is added. Set
   the same value as `PLAID_REDIRECT_URI` in Vercel (Production). Also add your
   Preview address (`https://<preview-domain>/oauth/plaid`) for the Sandbox
   rehearsal below; Sandbox accepts `http://localhost:3100/oauth/plaid` too for
   local testing, and Production never does. The app refuses a malformed value
   (wrong scheme, a query or fragment, a wildcard, any path other than
   `/oauth/plaid`) and answers 503 on the linking routes until it is fixed.
4. **Rehearse it in Sandbox first.** On the Preview deploy, with
   `PLAID_REDIRECT_URI` set and the Preview address registered, link
   Platypus OAuth Bank (`ins_127287`) using Plaid's documented Sandbox
   credentials (`setup/03-plaid.md`). You should leave the app for Plaid's
   OAuth screen, return to "Linking your bank" and land on My Institutions with
   the institution linked. This round trip needs a deployed address and a real
   browser, so it is not covered by the automated tests.

### 12. Re-read the guardrails before the switch

1. The access token is never shown, logged or returned; `src/server/log.ts` is
   the only logger and `src/server/log.test.ts` fails the gate on any other
   `console` call.
2. Sign-up is closed and `OWNER_EMAIL` is yours.
3. Production's `DATABASE_URL` is the `mmff_app` string (the check in step 3
   printed `f | f`).
4. Part 1's checks passed on a Preview and Part 2's on Production with Sandbox.

### 13. Switch Plaid to production (OWNER ONLY, never an agent)

Why: this is the point where real accounts and real data arrive. It needs two
switches on purpose, so a stray `PLAID_ENV=production` alone does nothing.

1. In Vercel, Production environment only, set `PLAID_SECRET` to your
   Production secret, `PLAID_ENV=production` and
   `MMFF_ALLOW_PLAID_PRODUCTION=true`.
2. Redeploy Production so the new values take effect.
3. Leave Preview on Sandbox. Never put the Production secret in a file on a
   laptop.

### 14. First real link

1. Sign in on the production URL, open My Institutions and press
   "+ Link an institution". Start with one account you can verify against your
   bank's own app.
2. Sign in on Plaid's screen, not ours; the app never sees your bank login.
3. Expect the card to read "Synced" with the right accounts and last digits.
   Credit and loan accounts show a minus amount marked "owed".
4. Transactions arrive in the background (up to 24 months). Allow a few minutes
   for the first pull and the webhook.

## Part 4. Verification: what each screen should show

Use this list after the first link, after every deploy and after any recovery.
A missing value is a dash, never `$0.00`; if you ever see a figure you cannot
trace to your bank, stop and treat it as a bug.

1. **My Institutions.** Each linked bank with "Synced" (`✓`) or "Needs
   reconnect" (`!`), its accounts with last digits and balances, and "N of 10
   linked".
2. **Overview.** Income and spending for this month (in your timezone), the dial
   with the gap in its centre (red and minus when overspent), a net-worth
   figure with its date and a sparkline, the five latest transactions, and a
   "Needs you" card that is either a reconnect alert or a green "Nothing".
   Income and spending exclude transfers and card payments.
3. **Budget.** "Left to spend", a row per category with a bar and a Today tick,
   and "Add a limit" for any category. Setting a limit shows a "Limit saved"
   message and the row appears.
4. **Transactions.** Newest first, searchable, filterable by All, Spending and
   Income. Transfers carry a "transfer" tag.
5. **Net worth.** The chart and range chips, plus the Investments view
   (allocation and holdings) and the Debts view (balance owed, limit used, due
   date) if you linked those accounts.
6. **Freshness.** After the first 09:00 UTC cron run, Net worth has a row for
   that date. Cron on Vercel Hobby can fire up to an hour late and can repeat;
   that is expected and harmless.
7. **Headers and console.** The checks in step 8 pass on the production URL too.

## Rollback

Why this section exists: you want to know how to undo a launch before you need
to.

1. **Bad deploy.** In Vercel, open Deployments, find the last good one and
   promote it (Instant Rollback). It does not touch the database, so it is safe
   if no migration shipped with the bad deploy.
2. **Plaid.** To stop pulling real data immediately, set
   `MMFF_ALLOW_PLAID_PRODUCTION` to anything other than `true` (or delete it)
   in Production and redeploy: the app then refuses production keys and fails
   closed with 503. To stop billing, unlink each Item in My Institutions, which
   calls Plaid's `/item/remove`.
3. **Database.** Migrations have no down scripts. Restore from the backup branch
   or snapshot from step 9 using Neon's restore, then re-apply forward from the
   migration you want. Do this from a terminal you control, never from an agent
   session.
4. **Lockout.** If you cannot sign in, check `OWNER_EMAIL` and the Auth
   variables first; the app fails closed by design, so a blank screen is a
   configuration problem, not a data loss.

## Key rotation

Rotate on a schedule and immediately if a value is ever pasted somewhere it
should not be. Treat deleting a commit as not enough.

1. **Plaid secret.** Rotate in the Plaid Dashboard, update the Vercel variable,
   redeploy.
2. **`mmff_app` password.** Run `ALTER ROLE mmff_app PASSWORD '...'` over the
   direct string as in step 3, then update `DATABASE_URL` everywhere and
   redeploy.
3. **`CRON_SECRET` and `NEON_AUTH_COOKIE_SECRET`.** Set new values and redeploy.
   Changing the cookie secret signs you out.
4. **`TOKEN_ENC_KEY`.** Do not just replace it, or every stored Plaid token
   becomes unreadable. Add the new key as `TOKEN_ENC_KEY_V2`, set
   `TOKEN_ENC_KEY_CURRENT_VERSION=2` and redeploy; old tokens still decrypt with
   their own version. Then re-encrypt the existing Items so the old key can be
   retired, with the guarded script described in
   `setup/05-secrets-and-security.md` ("Re-encrypting existing Items"): a dry
   run first, then `--apply`. Remove the old key only when the apply run
   reports no failures; the script prints counts only. Take a Neon snapshot or
   backup branch first, because the update rewrites `access_token_enc`.

## If a bank breaks

Banks drop connections often; it is usually not a bug.

1. **The Overview says "needs you to reconnect" or an institution shows `!`.**
   Plaid reported `ITEM_LOGIN_REQUIRED` (password change, expired consent or
   MFA). Press Reconnect on that card and sign in on Plaid's screen. This is
   Link's update mode: the Item keeps its id and history, no new row is made.
2. **An institution says it was disconnected.** You revoked access at the bank,
   or the bank did. Unlink it, then link it again. Note that history window
   (`days_requested`, 730) is fixed per Item at first link, so a relink starts a
   fresh Item with the full window.
3. **Figures look stale.** The balances come from Plaid's cached
   `/accounts/get`, which refreshes about daily. Check the date shown beside
   net worth, then run a manual sync (`POST /api/plaid/items/<id>/sync` as the
   owner) before suspecting a bug.
4. **A bank is missing from Link, or an OAuth bank fails.** Check Plaid's
   registration state and that the redirect URI is registered and matches
   `PLAID_REDIRECT_URI` exactly (step 11). If you land on "This bank sign-in
   expired", the browser lost Plaid's session (a different browser, over 30
   minutes, or cleared site data); start again from My Institutions.
5. **Still wrong.** Check Vercel's runtime logs: the lines are single JSON
   objects with an event name, status and error code only, never data. Then
   read `setup/07-troubleshooting.md`. Do not paste log lines containing
   anything from your accounts into an issue.

## Known follow-ups before you call it finished

These are open by design, not forgotten:

- Add a `LICENSE` before the repository goes public (owner decision, issue #2).
- A CI workflow for the gate needs your sign-off to add.
- Enable GitHub private vulnerability reporting so `SECURITY.md` works.
