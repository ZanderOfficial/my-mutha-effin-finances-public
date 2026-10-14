-- 0009: budget vs. actual (M9): budget targets on the sorting tables from 0006, and when budget checking starts.

-- A rule sorts one side of a source: its deposits (income, M7) or its spending (the budget, M9).
ALTER TABLE transaction_rules ADD COLUMN scope text NOT NULL DEFAULT 'deposit' CHECK (scope IN ('deposit', 'spending'));
ALTER TABLE transaction_rules DROP CONSTRAINT transaction_rules_owner_id_source_key_key;
ALTER TABLE transaction_rules ADD CONSTRAINT transaction_rules_owner_scope_source_key UNIQUE (owner_id, scope, source_key);

-- Spending goes to a planned item, or out of budget with an optional "For" tag and tax category.
ALTER TABLE transaction_rules DROP CONSTRAINT transaction_rules_kind_check;
ALTER TABLE transaction_rules
  ADD COLUMN planned_item_id uuid,
  ADD COLUMN tax_category_id uuid,
  ADD CONSTRAINT transaction_rules_kind_check CHECK (
    (scope = 'deposit' AND kind IN ('income', 'not_income'))
    OR (scope = 'spending' AND kind IN ('planned_item', 'out_of_budget'))
  ),
  ADD CONSTRAINT transaction_rules_target_check CHECK (
    (kind = 'planned_item') = (planned_item_id IS NOT NULL)
    AND (tax_category_id IS NULL OR kind = 'out_of_budget')
    AND (business_id IS NULL OR kind <> 'planned_item')
  ),
  ADD CONSTRAINT transaction_rules_planned_item_fkey FOREIGN KEY (owner_id, planned_item_id)
    REFERENCES planned_items (owner_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT transaction_rules_tax_category_fkey FOREIGN KEY (owner_id, tax_category_id)
    REFERENCES tax_categories (owner_id, id) ON DELETE SET NULL (tax_category_id);

-- The same targets for a decision about one transaction, which still beats any rule.
ALTER TABLE transaction_choices DROP CONSTRAINT transaction_choices_kind_check;
ALTER TABLE transaction_choices
  ADD COLUMN planned_item_id uuid,
  ADD COLUMN tax_category_id uuid,
  ADD CONSTRAINT transaction_choices_kind_check CHECK (kind IN ('income', 'not_income', 'planned_item', 'out_of_budget')),
  ADD CONSTRAINT transaction_choices_target_check CHECK (
    (kind = 'planned_item') = (planned_item_id IS NOT NULL)
    AND (tax_category_id IS NULL OR kind = 'out_of_budget')
    AND (business_id IS NULL OR kind <> 'planned_item')
  ),
  ADD CONSTRAINT transaction_choices_planned_item_fkey FOREIGN KEY (owner_id, planned_item_id)
    REFERENCES planned_items (owner_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT transaction_choices_tax_category_fkey FOREIGN KEY (owner_id, tax_category_id)
    REFERENCES tax_categories (owner_id, id) ON DELETE SET NULL (tax_category_id);

-- The first day of the month budget checking starts. Earlier spending is never checked.
CREATE TABLE budget_settings (
  owner_id   text PRIMARY KEY,
  start_date date NOT NULL CHECK (extract(day FROM start_date) = 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- M9 goes live in October 2026, so existing owners start then; the owner confirms it in operator issue #30.
INSERT INTO budget_settings (owner_id, start_date) SELECT DISTINCT owner_id, DATE '2026-10-01' FROM items;

-- Row-level security, as in 0002.
ALTER TABLE budget_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON budget_settings FOR ALL
  USING (owner_id = current_setting('app.owner_id', true))
  WITH CHECK (owner_id = current_setting('app.owner_id', true));
