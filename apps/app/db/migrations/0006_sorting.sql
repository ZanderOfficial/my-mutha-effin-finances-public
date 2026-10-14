-- 0006: the owner's sorting decisions, shared by income (M7) and budget vs. actual (M9).

-- A posted transaction points at the pending one it replaces (Plaid gives them different ids).
ALTER TABLE transactions ADD COLUMN pending_transaction_id text;

-- Who a transaction came from, as one stable key: the merchant if Plaid named one, else the
-- description. Lowercase letters only, because descriptions carry ids and dates that change.
ALTER TABLE transactions ADD COLUMN source_key text GENERATED ALWAYS AS (
  coalesce(
    nullif(btrim(regexp_replace(lower(coalesce(merchant, '')), '[^a-z]+', ' ', 'g')), ''),
    nullif(btrim(regexp_replace(lower(name), '[^a-z]+', ' ', 'g')), ''),
    lower(btrim(name))
  )
) STORED;

-- Lets other tables reference a transaction together with its owner.
ALTER TABLE transactions ADD CONSTRAINT transactions_owner_id_id_key UNIQUE (owner_id, id);

CREATE TABLE businesses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   text NOT NULL,
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name),
  UNIQUE (owner_id, id)
);

-- "Always treat this source as ...". business_id null means personal.
CREATE TABLE transaction_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    text NOT NULL,
  source_key  text NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 200),
  kind        text NOT NULL CHECK (kind IN ('income', 'not_income')),
  business_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, source_key),
  FOREIGN KEY (owner_id, business_id) REFERENCES businesses (owner_id, id) ON DELETE SET NULL (business_id)
);

-- A decision about one transaction. It beats a rule.
CREATE TABLE transaction_choices (
  transaction_id uuid PRIMARY KEY,
  owner_id       text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('income', 'not_income')),
  business_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_id, transaction_id) REFERENCES transactions (owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, business_id) REFERENCES businesses (owner_id, id) ON DELETE SET NULL (business_id)
);

-- Row-level security, as in 0002.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['businesses', 'transaction_rules', 'transaction_choices']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON public.%I FOR ALL '
      'USING (owner_id = current_setting(''app.owner_id'', true)) '
      'WITH CHECK (owner_id = current_setting(''app.owner_id'', true))',
      t
    );
  END LOOP;
END $$;
