# 05. Secrets and security

Why: this app will hold the keys to a view of your finances. A leaked
`TOKEN_ENC_KEY` plus a leaked database makes your Plaid access tokens
readable. The rules here come from `AGENTS.md` and the plan; they are
requirements, not suggestions.

## Generating `TOKEN_ENC_KEY` and `CRON_SECRET`

`TOKEN_ENC_KEY` is the key for AES-256-GCM encryption of Plaid access tokens.
It must be base64 text that decodes to exactly 32 bytes; the app refuses to
encrypt with anything else. AES-256 needs 32 random bytes. `CRON_SECRET` authenticates
Vercel's cron calls; Vercel recommends a random string of at least 16
characters (https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Generate each value on your own machine. Run the command once per variable and
use a different value every time.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the output straight into `apps/app/.env.local` and into the Vercel
Environment Variables screen. Do not paste it into a chat, a ticket or a
commit message.

Also set `OWNER_EMAIL` (the one address allowed to see data) and the Neon Auth
variables from `setup/02-neon-database.md`. If `OWNER_EMAIL` is unset, nobody is
the owner.

Use different values for local development, Vercel Preview and Vercel
Production.

## Never commit secrets

- `.gitignore` ignores `.env*` except `.env.example`. `.env.example` holds names
  only and must stay empty.
- Before every commit, check what you are about to add.

```bash
git status
```

- If a secret is ever committed or pasted somewhere, treat it as leaked:
  rotate it (below). Deleting the commit is not enough, because forks and
  caches keep copies.

## Rotating keys

- Plaid secret: rotate it in the Plaid Dashboard, update Vercel, redeploy.
- Neon password: reset the role password in the Neon Console, update
  `DATABASE_URL` everywhere it is set.
- `CRON_SECRET`: set a new value in Vercel and redeploy.
- `TOKEN_ENC_KEY`: do not simply replace it. Each token is stored as
  `version byte || iv || tag || ciphertext` and `items.key_version` records the
  version. To rotate:
  1. Generate a new key and add it as `TOKEN_ENC_KEY_V2` (the next rotation is
     `_V3`). Keep the old key (`TOKEN_ENC_KEY` is version 1) in place.
  2. Set `TOKEN_ENC_KEY_CURRENT_VERSION=2` and redeploy. New tokens are written
     with version 2; old tokens still decrypt with their own version.
  3. Re-encrypt existing items with the guarded script (next section).
  4. Only when the apply run reports no failures, remove the old key. Removing
     it earlier makes those tokens unreadable and forces a relink.
- `mmff_app` password: `ALTER ROLE mmff_app PASSWORD '...'` on the direct
  connection, then update `DATABASE_URL` everywhere it is set.

### Re-encrypting existing Items

Why: new tokens use the newest key, but Items linked earlier stay encrypted
under the old one until something rewrites them. The script
`apps/app/scripts/rotate-token-key.ts` decrypts each Item's access token with
the version it carries, encrypts it with the version in
`TOKEN_ENC_KEY_CURRENT_VERSION`, proves the new blob decrypts to the same
token, and updates `access_token_enc` and `key_version` together, one Item per
transaction under row-level security. An Item that cannot be rotated (missing
old key, damaged blob) is counted and left exactly as it was.

It never prints a token, an id, a key or a connection string, only counts. It
refuses to run unless `MMFF_ROTATE_CONFIRM=dev-or-prod` is set, writes only
when `--apply` is passed (otherwise it is a dry run), and refuses a database
role that bypasses row-level security. It needs Node 22.18 or newer.

1. Take a Neon snapshot or backup branch of the database you are about to
   change. The update is the only step that cannot be undone by redeploying.
2. In your own terminal, set the values in the shell for this session only
   (never in a file in the repository, never in a chat). Read each secret
   without echoing it:

```bash
read -rs DATABASE_URL && export DATABASE_URL
read -rs TOKEN_ENC_KEY && export TOKEN_ENC_KEY
read -rs TOKEN_ENC_KEY_V2 && export TOKEN_ENC_KEY_V2
export TOKEN_ENC_KEY_CURRENT_VERSION=2
export MMFF_ROTATE_CONFIRM=dev-or-prod
```

   `DATABASE_URL` is the `mmff_app` string for the branch you mean (dev or
   production). Both keys must be present so the old tokens can be read.
3. Dry run. This writes nothing and prints counts:

```bash
cd apps/app
node --no-warnings scripts/rotate-token-key.ts
```

   Expect `Failed (left unchanged): 0` and `Would re-encrypt:` equal to the
   number of Items not already on version 2.
4. Apply:

```bash
node --no-warnings scripts/rotate-token-key.ts --apply
```

   Expect `Re-encrypted:` to match the dry run and `Failed` to be 0. Run it
   again: it should report every Item as already on the target version.
5. Only now remove the old key (`TOKEN_ENC_KEY`, version 1) from Vercel and
   your local files, and redeploy. Check My Institutions still syncs. Then
   `unset` the variables in your terminal.

If anything fails, keep the old key. Items the script could not rotate still
read with it, and nothing was partly written.

## What must never be stored, anywhere

Per `AGENTS.md`, this data is prohibited: it never goes into the database,
logs, error reports, analytics, queues, URLs, emails or documents.

- Card numbers and bank account numbers (card data stays with the provider).
- Passwords and bank login credentials. Plaid Link handles these; the app
  never sees them.
- Government identification numbers.

What the app does keep is restricted: Plaid access tokens (encrypted),
account masks (last digits), balances and transactions. They sit behind
row-level security and never appear in logs.

## Log redaction

If you add a logger or an error path, make sure it cannot print request bodies,
tokens, connection strings or webhook payloads. A debugging `console.log` of a
Plaid response is exactly the mistake this rule exists to stop.

Server logging goes through `apps/app/src/server/log.ts`, which accepts only an
event name, a status, an error code, an error class name and a hashed item
reference. A test fails the gate if any other file calls `console`.

## Who is responsible for what

- You own your Neon, Vercel and Plaid accounts, your keys and your data, and
  every decision to link a real institution or turn on Production.
- The software is provided as is, with no warranty. It is not financial, tax or
  legal advice.
- The original developer does not host or hold anyone's data and cannot recover
  your keys or your database.
- Enable two-factor authentication on GitHub, Neon, Vercel and Plaid.
- If you use an AI agent, you are responsible for what you approve. Keep
  the approval gates in [06 MCP servers](06-mcp-servers.md).
