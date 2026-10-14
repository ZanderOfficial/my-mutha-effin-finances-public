-- 'one_time' (the owner, 2026-10-10): real spending the owner does not expect to repeat, so it never becomes
-- a line item. It carries a "For" tag and tax category like out of budget, and can be a charge's choice or
-- a merchant's Always rule (a merchant bought from only now and then).
ALTER TABLE transaction_choices DROP CONSTRAINT transaction_choices_kind_check;
ALTER TABLE transaction_choices
  ADD CONSTRAINT transaction_choices_kind_check
    CHECK (kind IN ('income', 'not_income', 'planned_item', 'out_of_budget', 'not_spending', 'transfer', 'one_time'));

ALTER TABLE transaction_rules DROP CONSTRAINT transaction_rules_kind_check;
ALTER TABLE transaction_rules
  ADD CONSTRAINT transaction_rules_kind_check CHECK (
    (scope = 'deposit' AND kind IN ('income', 'not_income'))
    OR (scope = 'spending' AND kind IN ('planned_item', 'out_of_budget', 'transfer', 'one_time'))
  );

-- A one-time charge carries a tax category, as out of budget does.
ALTER TABLE transaction_rules DROP CONSTRAINT transaction_rules_target_check;
ALTER TABLE transaction_rules
  ADD CONSTRAINT transaction_rules_target_check CHECK (
    (kind = 'planned_item') = (planned_item_id IS NOT NULL)
    AND (tax_category_id IS NULL OR kind IN ('out_of_budget', 'one_time'))
    AND (business_id IS NULL OR kind <> 'planned_item')
  );

ALTER TABLE transaction_choices DROP CONSTRAINT transaction_choices_target_check;
ALTER TABLE transaction_choices
  ADD CONSTRAINT transaction_choices_target_check CHECK (
    (kind = 'planned_item') = (planned_item_id IS NOT NULL)
    AND (tax_category_id IS NULL OR kind IN ('out_of_budget', 'one_time'))
    AND (business_id IS NULL OR kind <> 'planned_item')
  );
