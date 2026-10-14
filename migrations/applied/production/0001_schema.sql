-- 0001_schema.sql: the MMFF tables.
--
-- Conventions, all load-bearing:
--  * Money is integer cents in bigint columns. No float, real or numeric money.
--    A NULL money column means "unknown", never zero. Rates are integer basis
--    points (1 bp = 0.01 percent). The only numeric column is holdings.quantity,
--    which is a count of units, not money.
--  * Every table carries owner_id text NOT NULL, the id of the signed-in owner
--    (Neon Auth user id). Row-level security (0002) is scoped on it.
--  * Child tables reference their parent with a composite key (owner_id, id) so
--    a row can never point at another owner's parent, even though foreign key
--    checks run without row-level security.
--  * Prohibited data (card numbers, bank account numbers, credentials,
--    government ids) has no column anywhere. accounts.mask is a truncated
--    form, still restricted data.
--  * transactions.amount_cents is NORMALISED at ingest, not Plaid's native sign:
--    spending is NEGATIVE, income is POSITIVE. Plaid sends outflows positive.

CREATE TABLE items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          text NOT NULL,
  plaid_item_id     text NOT NULL UNIQUE,
  -- AES-256-GCM envelope: version byte || iv || tag || ciphertext. Never plaintext.
  access_token_enc  bytea NOT NULL,
  key_version       integer NOT NULL CHECK (key_version BETWEEN 1 AND 255),
  tx_cursor         text,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'needs_reauth', 'revoked')),
  last_error_code   text,
  institution_id    text,
  institution_name  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id)
);

CREATE TABLE accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              text NOT NULL,
  item_id               uuid NOT NULL,
  plaid_account_id      text NOT NULL UNIQUE,
  name                  text NOT NULL,
  official_name         text,
  type                  text NOT NULL,
  subtype               text,
  is_liability          boolean NOT NULL,
  balance_cents         bigint,
  available_cents       bigint,
  limit_cents           bigint,
  iso_currency_code     text,
  -- Truncated account mask (last digits only). Restricted data.
  mask                  text CHECK (mask IS NULL OR char_length(mask) <= 4),
  balance_updated_at    timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, item_id) REFERENCES items (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX accounts_owner_item_idx ON accounts (owner_id, item_id);

CREATE TABLE balance_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       text NOT NULL,
  account_id     uuid NOT NULL,
  snapshot_date  date NOT NULL,
  balance_cents  bigint NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, snapshot_date),
  FOREIGN KEY (owner_id, account_id) REFERENCES accounts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX balance_snapshots_owner_date_idx ON balance_snapshots (owner_id, snapshot_date);

CREATE TABLE transactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              text NOT NULL,
  account_id            uuid NOT NULL,
  plaid_transaction_id  text NOT NULL UNIQUE,
  -- Normalised sign: spending NEGATIVE, income POSITIVE (Plaid's is inverted).
  amount_cents          bigint NOT NULL,
  date                  date NOT NULL,
  pending               boolean NOT NULL DEFAULT false,
  name                  text NOT NULL,
  merchant              text,
  category              text,
  category_detail       text,
  removed_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_id, account_id) REFERENCES accounts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX transactions_owner_date_idx ON transactions (owner_id, date DESC) WHERE removed_at IS NULL;
CREATE INDEX transactions_account_date_idx ON transactions (account_id, date DESC);

CREATE TABLE securities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          text NOT NULL,
  plaid_security_id text NOT NULL,
  name              text,
  ticker            text,
  type              text,
  close_price_cents bigint,
  close_price_date  date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, plaid_security_id),
  UNIQUE (owner_id, id)
);

CREATE TABLE holdings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                text NOT NULL,
  account_id              uuid NOT NULL,
  security_id             uuid NOT NULL,
  -- Units held; the one non-money numeric in the schema.
  quantity                numeric(28, 10) NOT NULL,
  institution_value_cents bigint,
  cost_basis_cents        bigint,
  as_of                   date,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, security_id),
  FOREIGN KEY (owner_id, account_id) REFERENCES accounts (owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, security_id) REFERENCES securities (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX holdings_owner_account_idx ON holdings (owner_id, account_id);
CREATE INDEX holdings_security_idx ON holdings (owner_id, security_id);

CREATE TABLE liabilities (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                     text NOT NULL,
  account_id                   uuid NOT NULL UNIQUE,
  kind                         text NOT NULL CHECK (kind IN ('credit', 'mortgage', 'student', 'other')),
  next_due_date                date,
  min_payment_cents            bigint,
  last_statement_balance_cents bigint,
  last_statement_date          date,
  -- Rates are integer basis points: 24.99 percent is 2499.
  apr_bps                      integer CHECK (apr_bps IS NULL OR apr_bps >= 0),
  apr_type                     text,
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_id, account_id) REFERENCES accounts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX liabilities_owner_due_idx ON liabilities (owner_id, next_due_date);

CREATE TABLE budgets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    text NOT NULL,
  category    text NOT NULL,
  -- Owner-set monthly limit for the category.
  limit_cents bigint NOT NULL CHECK (limit_cents >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, category)
);

CREATE TABLE net_worth_daily (
  owner_id          text NOT NULL,
  date              date NOT NULL,
  assets_cents      bigint NOT NULL,
  -- Positive magnitude owed; net_worth_cents = assets_cents - liabilities_cents.
  liabilities_cents bigint NOT NULL,
  net_worth_cents   bigint NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, date)
);

-- owner_id is NOT NULL here too. A webhook arrives without a session, so the
-- M4 webhook route must resolve the owner before inserting (for example from
-- the matching items row) and run under withOwner like everything else.
CREATE TABLE provider_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      text NOT NULL,
  provider      text NOT NULL DEFAULT 'plaid',
  event_type    text NOT NULL,
  event_code    text,
  plaid_item_id text,
  -- sha256 of body + type + code + item id; replays collide here.
  dedup_key     text NOT NULL UNIQUE,
  -- Ids and codes only. The allowlist keeps free-form provider text out.
  payload       jsonb NOT NULL
                CHECK (
                  jsonb_typeof(payload) = 'object'
                  AND (payload - ARRAY[
                    'webhook_type', 'webhook_code', 'item_id', 'error_code',
                    'account_ids', 'new_transactions', 'removed_transactions',
                    'initial_update_complete', 'historical_update_complete',
                    'environment'
                  ]) = '{}'::jsonb
                ),
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  -- A short error code only, never a message body.
  error         text CHECK (error IS NULL OR char_length(error) <= 200)
);
CREATE INDEX provider_events_owner_received_idx ON provider_events (owner_id, received_at DESC);
CREATE INDEX provider_events_unprocessed_idx ON provider_events (owner_id, received_at) WHERE processed_at IS NULL;
