# Migration record

This is the log of which migrations have been applied to which database. There
is no migration runner, so this file is the only record. Update it in the same
commit as every apply.

## Dev branch (Neon, branch `vercel-dev`)

Applied on 2026-10-03, in order, each file as one transaction, through the Neon
connector in a Claude Code session after the owner approved it in chat. The
SQL was sent statement by statement (the connector runs one statement at a
time) with the comments left out; the statements are the ones in the files.
Afterwards the result was checked with read-only queries: all ten tables have
row-level security enabled and forced with one policy each, `mmff_app` is not a
superuser and cannot bypass row-level security, and the owner of the two
definer functions in `0004` does bypass it.

| # | File | SHA-256 of the file (LF line endings) | Status |
| --- | --- | --- | --- |
| 0001 | `applied/dev/0001_schema.sql` | `9f15ba634c4f25a64d3b8671b14867db3e38838e0eaf3894416816f2d7d9501f` | applied |
| 0002 | `applied/dev/0002_rls.sql` | `253748fda48dd04ecdbc4e97899c1876a3cdce7efd54244f0cb45363e6867a69` | applied |
| 0003 | `applied/dev/0003_runtime_role.sql` | `1feac4b5d54f86c2aad8f4894d2b8c574754ab96d5625efba003e6832b4e1479` | applied |
| 0004 | `applied/dev/0004_sync.sql` | `995500a22f649af35e7035bb5458a9a223bcdbde5f4f0d3a1dfb03f0ba6e956f` | applied |

`0005` to `0009` are not applied here: since 2026-10-04 the owner has had all database
work go to production.

Not done yet on this branch: setting the `mmff_app` password (the owner does
this by hand, see `setup/02-neon-database.md`).

## Production branch (Neon, branch `production`)

Applied on 2026-10-04, in order, each file as one transaction, through the Neon
connector in a Claude Code session, on the owner's explicit instruction in chat
to use production for everything until told otherwise. Same method as dev (one
statement at a time, comments left out). Checked afterwards with read-only
queries: 10 of 10 tables have row-level security enabled and forced, 10
policies exist, `mmff_app` is not a superuser and cannot bypass row-level
security, `net_worth_daily.incomplete` exists, and the `private` schema holds
the two definer functions.

| # | File | SHA-256 of the file (LF line endings) | Status |
| --- | --- | --- | --- |
| 0001 | `applied/production/0001_schema.sql` | `9f15ba634c4f25a64d3b8671b14867db3e38838e0eaf3894416816f2d7d9501f` | applied |
| 0002 | `applied/production/0002_rls.sql` | `253748fda48dd04ecdbc4e97899c1876a3cdce7efd54244f0cb45363e6867a69` | applied |
| 0003 | `applied/production/0003_runtime_role.sql` | `1feac4b5d54f86c2aad8f4894d2b8c574754ab96d5625efba003e6832b4e1479` | applied |
| 0004 | `applied/production/0004_sync.sql` | `995500a22f649af35e7035bb5458a9a223bcdbde5f4f0d3a1dfb03f0ba6e956f` | applied |
| 0005 | `applied/production/0005_loans.sql` | `a19a7cd808896ddf7c9fd981aaa5aca045275a0a671ce3d7ce11548d35c15cda` | applied 2026-10-07 |
| 0006 | `applied/production/0006_sorting.sql` | `c1c5c47525fa53da2839e2c80d08a69f092633e0b27a4d8d59d480d049269207` | applied 2026-10-07 |
| 0007 | `applied/production/0007_planned.sql` | `227a42cdb5df61768aed12bed60574ce9ba3a0e8b5a8e82b1536ac01e07d81aa` | applied 2026-10-09 |
| 0008 | `applied/production/0008_schedule_c.sql` | `9bfc9e238d89363a33a3f2a5f1ed69546be55c360ad3876a22015d2c4e51491c` | applied 2026-10-09 |
| 0009 | `applied/production/0009_budget_actual.sql` | `9fa0d827c64a99926ffd0043a523fe6ffcb985331b2e2afdf2a7e0f76d101281` | applied 2026-10-09 |

`0005` was applied on 2026-10-07 through the Neon connector, as one
transaction, on the owner's instruction in chat. It was applied before the code
that reads its columns was deployed. Checked afterwards with read-only queries:
- `liabilities_kind_check` allows `loan` and `line_of_credit`;
- the four new columns exist;
- `liabilities` still has row-level security enabled and forced;
- `mmff_app` can still read and write the table;
- the existing rows are untouched.

`0006` was applied on 2026-10-07 the same way, before the code that writes
`pending_transaction_id` was pushed. Checked afterwards:
- all 13 public tables have row-level security enabled and forced;
- the three new tables have their owner policy;
- `mmff_app` can write them and still cannot bypass RLS;
- every existing transaction got a `source_key`.

`0007` was applied on 2026-10-09 the same way, on the owner's approval in
chat, before the code that writes its tables (#21) was pushed. It adds three
empty tables and changes no existing row. Checked afterwards:
- all 16 public tables have row-level security enabled and forced;
- the three new tables have their owner policy;
- `mmff_app` can write them and still cannot bypass RLS;
- the one-level trigger and both foreign keys on `planned_items` exist;
- the existing tables were untouched.

`0008` was applied on 2026-10-09 the same way, on the owner's approval in
chat, before the code that reads it (#23, #24) was pushed. It adds the
`reference` schema with the 2025 Schedule C expense lines and four mapping
columns on the then-empty `tax_categories`. Checked afterwards:
- 25 lines for 2025, in form order;
- an md5 over every column of every row equal to the same hash computed
  from the migration file applied locally;
- `mmff_app` can read the lines and cannot write them;
- the four columns and three constraints exist;
- all 16 public tables still have row-level security enabled and forced.

`0009` was applied on 2026-10-09 the same way, on the owner's approval in
chat, before the M9 code that needs it (#27 to #29) was pushed. It changes
`transaction_rules` and `transaction_choices`, both empty in production at
the time, and adds `budget_settings` with the owner's start date. Checked
afterwards:
- all 17 public tables have row-level security enabled and forced;
- `budget_settings` has its owner policy, one row, start date 2026-10-01;
- `mmff_app` can write it and still cannot bypass RLS;
- the new columns and constraints on both sorting tables exist;
- the transactions were untouched.

Every hash in both tables is taken over LF line endings
(`tr -d '\r' < file | sha256sum`), which is also how Git stores the files. The
0001 to 0004 rows first held the hashes of a Windows checkout's CRLF copies;
they were corrected to the LF hashes on 2026-10-09. The files themselves did
not change: dev and production copies are identical to each other and to
`apps/app/db/migrations/`.

Not done yet on this branch: setting the `mmff_app` password (the owner does
this by hand, see `setup/02-neon-database.md`).
