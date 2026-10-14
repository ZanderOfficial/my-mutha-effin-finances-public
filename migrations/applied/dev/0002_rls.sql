-- 0002_rls.sql: row-level security on EVERY table, scoped by owner.
--
-- The app sets app.owner_id per transaction with set_config(..., true). With the
-- setting absent, current_setting(..., true) is NULL, the comparison is NULL,
-- and no row is visible or writable: fail closed. FORCE applies the policy to
-- the table owner as well. Superusers and BYPASSRLS roles still skip RLS, which
-- is why 0003 creates a dedicated runtime role without BYPASSRLS.
--
-- A new table in a later migration must repeat this block; the RLS test fails
-- the build if any public table lacks enabled and forced RLS.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'items', 'accounts', 'balance_snapshots', 'transactions', 'securities',
    'holdings', 'liabilities', 'budgets', 'net_worth_daily', 'provider_events'
  ]
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
