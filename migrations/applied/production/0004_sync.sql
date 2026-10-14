-- 0004_sync.sql: what M4 (sync, webhooks, daily snapshot) needs.
--
-- 1. net_worth_daily.incomplete: true when at least one account had an unknown
--    (NULL) balance that day, so the row understates net worth. Unknown is
--    never treated as zero, so the flag travels with the row.
--
-- 2. Two narrowly scoped lookups for the two callers that have no signed-in
--    user: a Plaid webhook (knows only the Plaid item id) and the cron job
--    (knows nothing). Both tables are under FORCE row-level security, and the
--    runtime role mmff_app has no owner id to set yet, so it could read
--    nothing. These SECURITY DEFINER functions run as the migration role (the
--    project owner on Neon, which has BYPASSRLS; a superuser in PGlite) and
--    expose exactly one thing each: an owner id. They return no item, token,
--    account or money data. search_path is pinned to '' so a caller cannot
--    shadow objects; EXECUTE is revoked from PUBLIC and granted to mmff_app only.
--    Once the owner id is known, everything else runs under withOwner as usual.

ALTER TABLE net_worth_daily ADD COLUMN incomplete boolean NOT NULL DEFAULT false;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO mmff_app;

CREATE FUNCTION private.owner_for_plaid_item(p_item_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT owner_id FROM public.items WHERE plaid_item_id = p_item_id LIMIT 1 $$;

CREATE FUNCTION private.item_owner_ids()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT DISTINCT owner_id FROM public.items $$;

REVOKE ALL ON FUNCTION private.owner_for_plaid_item(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.item_owner_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.owner_for_plaid_item(text) TO mmff_app;
GRANT EXECUTE ON FUNCTION private.item_owner_ids() TO mmff_app;
