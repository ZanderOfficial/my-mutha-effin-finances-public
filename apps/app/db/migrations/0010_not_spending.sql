-- Two ways to say a charge is not spending, both decided by the owner (2026-10-10):
-- 'transfer': money moved to another of the owner's accounts that Plaid does not label a transfer
--   (a payment to a credit union account, say). A charge, or a merchant through an Always rule.
-- 'not_spending': money that left and came back (a deposit returned from escrow). A single charge
--   only; no rule can say it, since a merchant's other charges are real spending.
ALTER TABLE transaction_choices DROP CONSTRAINT transaction_choices_kind_check;
ALTER TABLE transaction_choices
  ADD CONSTRAINT transaction_choices_kind_check
    CHECK (kind IN ('income', 'not_income', 'planned_item', 'out_of_budget', 'not_spending', 'transfer'));

ALTER TABLE transaction_rules DROP CONSTRAINT transaction_rules_kind_check;
ALTER TABLE transaction_rules
  ADD CONSTRAINT transaction_rules_kind_check CHECK (
    (scope = 'deposit' AND kind IN ('income', 'not_income'))
    OR (scope = 'spending' AND kind IN ('planned_item', 'out_of_budget', 'transfer'))
  );
