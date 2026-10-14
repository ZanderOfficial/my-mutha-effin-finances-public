-- 0005: closed-end loans and lines of credit from Plaid Liabilities.
--
-- Plaid returns auto, personal and other closed-end loans in a `loan` array
-- and lines of credit in `line_of_credit`, next to `credit`, `mortgage` and
-- `student`. The adapter read only the last three, so a linked auto loan had
-- its balance (from /accounts/get) but no payment, rate or payoff.
--
-- For a loan, min_payment_cents holds the scheduled next payment (a loan has
-- no "minimum"); the Debts view labels it accordingly.
--
-- Plaid's loan object also carries the full account number. That is
-- prohibited data, so there is deliberately no column for it, and the adapter
-- never reads the field.
--
-- No new table, so the row-level security from 0002 already covers this.

ALTER TABLE liabilities DROP CONSTRAINT liabilities_kind_check;

ALTER TABLE liabilities ADD CONSTRAINT liabilities_kind_check
  CHECK (kind IN ('credit', 'mortgage', 'student', 'loan', 'line_of_credit', 'other'));

ALTER TABLE liabilities
  ADD COLUMN payoff_cents       bigint CHECK (payoff_cents IS NULL OR payoff_cents >= 0),
  ADD COLUMN maturity_date      date,
  ADD COLUMN last_payment_cents bigint CHECK (last_payment_cents IS NULL OR last_payment_cents >= 0),
  ADD COLUMN last_payment_date  date;
