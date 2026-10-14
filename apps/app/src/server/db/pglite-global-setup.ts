/** Vitest global setup: migrates one PGlite database per run, so test files copy it instead of each paying PGlite's slow first boot. */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** Path to the tarball of a freshly migrated PGlite data directory. */
    pgliteSnapshot: string;
  }
}

const MIGRATIONS = join(process.cwd(), "db", "migrations");

/** The migration files, in the order they are applied. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** Applies every migration to an empty PGlite and writes its data directory to `path`. */
async function writeSnapshot(path: string): Promise<void> {
  const pg = new PGlite();
  try {
    for (const file of migrationFiles()) {
      await pg.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    }
    // Uncompressed: test files load it in parallel, and CPU is what they compete for.
    const dump = await pg.dumpDataDir("none");
    writeFileSync(path, Buffer.from(await dump.arrayBuffer()));
  } finally {
    await pg.close();
  }
}

export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), "mmff-pglite-"));
  const path = join(dir, "migrated.tar");
  await writeSnapshot(path);
  project.provide("pgliteSnapshot", path);

  // Watch mode reruns tests without rerunning this setup; rebuild so an edited migration applies.
  project.onTestsRerun(() => writeSnapshot(path));

  return () => rmSync(dir, { recursive: true, force: true });
}
