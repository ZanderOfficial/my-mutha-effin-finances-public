import { getPlaidProvider } from "@/server/plaid";
import { createSyncRepo } from "./repository";
import { createSyncService } from "./service";
import { createSnapshotService } from "./snapshot";
import { ownerTimezone } from "./timezone";

/** Throws PlaidConfigError (fail closed) on bad configuration. */
export function getSyncService() {
  return createSyncService({ plaid: getPlaidProvider(), repo: createSyncRepo() });
}

/** Throws PlaidConfigError or TimezoneConfigError (fail closed) on bad configuration. */
export function getSnapshotRunner() {
  const repo = createSyncRepo();
  const sync = createSyncService({ plaid: getPlaidProvider(), repo });
  return {
    repo,
    snapshot: createSnapshotService({ repo, sync, timeZone: ownerTimezone() }),
  };
}
