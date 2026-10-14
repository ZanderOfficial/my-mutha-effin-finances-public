# 02. Neon database

Why: Vercel functions have no persistent storage, so balances, transactions
and encrypted Plaid tokens will live in serverless Postgres. Neon is the
recommended and planned provider (see `docs/plan/IMPLEMENTATION-PLAN.md`).

State today: milestone M2 added the schema (`apps/app/db/migrations/`), the
data access layer (`apps/app/src/server/db/`) and owner auth. Nothing links a
bank yet.

## Steps

1. Create a Neon account at neon.com and create a project. Name it something
   you will recognise, for example `mmff`. Pick the region closest to where you
   will deploy on Vercel.

2. Understand branches. A Neon branch is a copy-on-write clone of your data
   (https://neon.com/docs/introduction/branching). A new project starts with a
   root branch, which Neon's docs call `main`. The owner's notes in
   `docs/LOCAL-DEV.md` use two branches named `production` and `vercel-dev`.
   Whatever you name them, keep this split:
   - the root branch holds your real data and is only touched by a deployed,
     reviewed app;
   - a second branch (for example `dev`) is for local work and tests.

3. Create the development branch in the Neon Console (Branches, then create a
   branch from the root). The Neon CLI and API can do the same.

4. Copy the connection string for the development branch from the Console's
   connection details. Treat it as a secret: it contains a password.

5. Choose pooled or direct. Per Neon
   (https://neon.com/docs/connect/connection-pooling):
   - A pooled string has `-pooler` in the hostname. It uses PgBouncer in
     transaction mode and suits serverless functions and web apps.
   - A direct string has no `-pooler`. Use it for schema migrations, `pg_dump`
     and admin tasks, because pooled mode does not support session features
     such as `SET`, `LISTEN/NOTIFY`, temporary tables or SQL-level `PREPARE`.

   The split for this app: **migrations and `ALTER ROLE` use the direct string
   as the project owner role; the running app uses the pooled string as the
   `mmff_app` role** (see "Apply the migrations" below). You need one of each.

6. Put the development string in `apps/app/.env.local`.

```text
DATABASE_URL=<paste your dev-branch connection string here>
```

7. Verify the connection safely, with a read-only query on the development
   branch only. This needs `psql` and your env file loaded into the shell.

```bash
psql "$DATABASE_URL" -c "select 1"
```

   If you have no `psql`, open the SQL Editor in the Neon Console on the
   development branch and run `select 1`. Never run write statements against
   the root branch to "test".

## Apply the migrations (your dev branch only)

The migrations are plain SQL, numbered, and meant to be run in order by you.
No agent applies them for you, and never run them on the production branch from
a development session.

1. `0001_schema.sql` creates the ten tables (integer-cent money, owner id on
   every row).
2. `0002_rls.sql` enables and forces row-level security with an owner policy.
3. `0003_runtime_role.sql` creates the `mmff_app` role without `BYPASSRLS`.

With the **direct** dev-branch string of the project owner role in
`MIGRATE_URL` (a shell variable, never a file in the repo):

```bash
for f in apps/app/db/migrations/*.sql; do psql "$MIGRATE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

Or paste each file into the Neon SQL Editor on the dev branch, in order. Each
file runs once; there is no migration runner yet, so record what you applied in
`migrations/RECORD.md` (see `migrations/README.md`).

### The runtime role and its password

Neon's default roles can bypass row-level security, so the app must not connect
as one. After `0003`, set a password for `mmff_app` out of band (generate a
long random one, do not paste it into a chat):

```sql
ALTER ROLE mmff_app PASSWORD '<generated password>';
```

Build the **pooled** connection string (host contains `-pooler`), user
`mmff_app`, that password, and put it in `DATABASE_URL`. Check it is really
restricted: `select rolbypassrls, rolsuper from pg_roles where rolname = current_user`
must return `f, f`.

## Rules

- Never run migrations against production from a development session
  (`AGENTS.md`). Migrations against production are run by you, by hand, from a
  reviewed change.
- Row-level security on every table, scoped by account, is a project rule that
  M2 implements. Do not weaken it to make a query work.
- On Vercel, the Neon integration injects `DATABASE_URL` as a pooled string and
  `DATABASE_URL_UNPOOLED` as a direct one
  (https://neon.com/docs/guides/vercel-managed-integration). See step 04.

## Neon Auth (owner sign-in)

The app uses Neon's managed Better Auth (`@neondatabase/auth`).

1. In the Neon Console for your project, enable Auth on the dev branch and
   create your own user (email and password).
2. Copy the Auth URL into `NEON_AUTH_BASE_URL`.
3. Generate `NEON_AUTH_COOKIE_SECRET` (at least 32 characters,
   `openssl rand -base64 32`).
4. Set `OWNER_EMAIL` to your address. Only that account is treated as the
   owner; any other signed-in user sees nothing.
5. Then turn public sign-up off in the Auth settings so nobody else can
   register.

With any of these missing the app fails closed (see `docs/trapstoknow.md`).

## MCP

An AI agent can drive Neon for you; see [06 MCP servers](06-mcp-servers.md).
