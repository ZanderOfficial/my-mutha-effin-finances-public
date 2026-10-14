/** Re-encrypts stored Plaid tokens under the newest TOKEN_ENC_KEY version so the old key can be retired. */
// How to run it, and which keys to set: setup/05-secrets-and-security.md.
import { Pool } from "@neondatabase/serverless";
import { runWithOwner, type Queryable } from "../src/server/db/run-with-owner.ts";
import {
  parseRotateMode,
  rotateAll,
  type RotateCounts,
  type WithOwner,
} from "../src/server/crypto/rotate-items.ts";
import { currentKeyVersion } from "../src/server/crypto/tokens.ts";

type Config =
  | { ok: true; apply: boolean; databaseUrl: string; targetVersion: number }
  | { ok: false; reason: string };

async function main(): Promise<number> {
  const config = readConfig();
  if (!config.ok) return refuse(config.reason);

  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    // The app never connects as a role that bypasses RLS; neither may this script.
    if (await bypassesRls(pool)) {
      return refuse("Refusing to run: DATABASE_URL must be the restricted mmff_app role, not an owner role.");
    }

    printPlan(config.apply, config.targetVersion);
    const counts = await rotateAll(ownerScoped(pool), await ownerIds(pool), process.env, config.apply);
    return printReport(counts, config.apply);
  } finally {
    await pool.end();
  }
}

/** Reads the run mode, connection string and target key version from the command line and shell. */
function readConfig(): Config {
  const mode = parseRotateMode(process.argv.slice(2), process.env);
  if (!mode.ok) return mode;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return { ok: false, reason: "Refusing to run: DATABASE_URL is not set." };

  try {
    return { ok: true, apply: mode.apply, databaseUrl, targetVersion: currentKeyVersion(process.env) };
  } catch {
    return { ok: false, reason: "Refusing to run: TOKEN_ENC_KEY_CURRENT_VERSION is invalid." };
  }
}

/** True when the connected role is a superuser or can bypass row-level security. */
async function bypassesRls(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
    "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user",
  );
  const role = rows[0];
  return !role || role.rolbypassrls || role.rolsuper;
}

/** Runs each owner's work on its own pooled connection, inside that owner's RLS scope. */
function ownerScoped(pool: Pool): WithOwner {
  return async (ownerId, fn) => {
    const client = await pool.connect();
    try {
      return await runWithOwner(client as unknown as Queryable, ownerId, fn);
    } finally {
      client.release();
    }
  };
}

/** Every owner with a linked Item, read through the one allowed unscoped lookup. */
async function ownerIds(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ owner_id: string }>(
    "SELECT owner_id FROM private.item_owner_ids() AS owner_id",
  );
  return rows.map((row) => row.owner_id);
}

// Output is counts and fixed sentences only: never a token, an id, a key or a connection string.

function printPlan(apply: boolean, targetVersion: number): void {
  print(apply ? "Mode: APPLY (writing)" : "Mode: dry run (nothing is written)");
  print(`Target key version: ${targetVersion}`);
}

/** Prints the counts and returns the exit code: 1 if any Item was left unrotated. */
function printReport(counts: RotateCounts & { owners: number }, apply: boolean): number {
  print(`Owners: ${counts.owners}`);
  print(`Items: ${counts.items}`);
  print(`Already on the target version: ${counts.current}`);
  print(apply ? `Re-encrypted: ${counts.rotated}` : `Would re-encrypt: ${counts.wouldRotate}`);
  print(`Failed (left unchanged): ${counts.failed}`);

  if (counts.failed > 0) {
    print("Some Items could not be rotated. Keep the old key until every failure is understood.");
    return 1;
  }
  if (apply) print("Every Item is on the target version. The old key can now be removed.");
  return 0;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function refuse(reason: string): number {
  process.stderr.write(`${reason}\n`);
  return 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write("Rotation stopped on an unexpected error. Nothing further was written.\n");
    process.exitCode = 1;
  },
);
