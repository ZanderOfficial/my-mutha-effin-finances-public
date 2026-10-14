/** Test-only: a private copy of the migrated PGlite database, opened as the runtime role so row-level security applies. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { inject } from "vitest";

export { migrationFiles } from "./pglite-global-setup";

/** Loads the snapshot made by `pglite-global-setup.ts` into a new in-memory PGlite. */
export async function openTestDb(): Promise<PGlite> {
  const snapshot = inject("pgliteSnapshot");
  if (!snapshot) {
    throw new Error("No PGlite snapshot: run the tests through vitest.config.ts, whose globalSetup makes it.");
  }

  const pg = new PGlite({ loadDataDir: new Blob([readFileSync(snapshot)]) });
  // The test session is a superuser, which bypasses RLS; the app's role does not.
  await pg.exec("SET ROLE mmff_app");
  return pg;
}
