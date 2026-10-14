-- The owner's own list for breaking down one-time spending (Eating out, Clothes, ...), the owner's 2026-10-10 decision.
-- It says what a purchase was; the tax category still says where it lands for tax.
CREATE TABLE one_time_kinds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   text NOT NULL,
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name),
  UNIQUE (owner_id, id)
);

-- A one-time charge, or a merchant's one-time rule, may name its kind. Removing a kind leaves it unnamed.
ALTER TABLE transaction_choices
  ADD COLUMN one_time_kind_id uuid,
  ADD CONSTRAINT transaction_choices_one_time_kind_check CHECK (one_time_kind_id IS NULL OR kind = 'one_time'),
  ADD CONSTRAINT transaction_choices_one_time_kind_fkey FOREIGN KEY (owner_id, one_time_kind_id)
    REFERENCES one_time_kinds (owner_id, id) ON DELETE SET NULL (one_time_kind_id);

ALTER TABLE transaction_rules
  ADD COLUMN one_time_kind_id uuid,
  ADD CONSTRAINT transaction_rules_one_time_kind_check CHECK (one_time_kind_id IS NULL OR kind = 'one_time'),
  ADD CONSTRAINT transaction_rules_one_time_kind_fkey FOREIGN KEY (owner_id, one_time_kind_id)
    REFERENCES one_time_kinds (owner_id, id) ON DELETE SET NULL (one_time_kind_id);

-- Row-level security, as in 0002.
ALTER TABLE public.one_time_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_time_kinds FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON public.one_time_kinds FOR ALL
  USING (owner_id = current_setting('app.owner_id', true))
  WITH CHECK (owner_id = current_setting('app.owner_id', true));
