# Migrations: what was applied, and where

Why this directory exists: the app has no migration runner, so nothing in the
database says which migrations ran. This directory is that memory.

- **`apps/app/db/migrations/`** is the source. The tests apply these files to
  an in-process Postgres, and new migrations are written there.
- **`migrations/applied/<environment>/`** holds an exact copy of each file at
  the moment it was applied to that environment (`dev` for the development
  Neon branch, `production` for the production branch).
- **`RECORD.md`** lists, per environment, which files were applied, when, and
  their SHA-256.

## Rules

1. **An applied migration is never edited.** If it needs to change, write a new
   numbered migration. A test (`apps/app/src/server/db/applied-migrations.test.ts`)
   fails the gate if a file under `applied/` differs from its source.
2. **Apply in order, to the dev branch first.** Never apply to production from a
   development session; the owner does that by hand.
3. **After applying, in the same commit:** copy the file into
   `applied/<environment>/`, add a row to `RECORD.md`, and add the hash:

   ```bash
   sha256sum apps/app/db/migrations/0005_example.sql
   ```

4. **Check the result with read-only queries** (row-level security enabled and
   forced on every table, `mmff_app` not able to bypass it) and note that in
   `RECORD.md`.

Only schema is recorded here. No data, connection string or password is ever
written to this directory.
