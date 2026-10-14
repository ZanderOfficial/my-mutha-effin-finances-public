-- 0003_runtime_role.sql: the role the app connects as at runtime.
--
-- Neon's default roles (including the one created with the project) can bypass
-- row-level security, so an app connecting as one of them would ignore every
-- policy in 0002. mmff_app is created NOBYPASSRLS, NOSUPERUSER and cannot
-- create objects or roles. It has no password here: the owner sets one out of
-- band (ALTER ROLE mmff_app PASSWORD '...' run by hand) and builds
-- DATABASE_URL for this role. See setup/02-neon-database.md.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmff_app') THEN
    CREATE ROLE mmff_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO mmff_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mmff_app;

-- Tables added by later migrations (run by this same role) get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mmff_app;
