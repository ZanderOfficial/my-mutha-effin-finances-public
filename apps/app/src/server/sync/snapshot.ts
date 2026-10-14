import { itemRef, logError, logException } from "@/server/log";
import { computeNetWorth } from "./networth";
import type { SyncRepo } from "./repository";
import type { SyncService } from "./service";
import { dateInTimezone } from "./timezone";

export type SnapshotResult = {
  date: string;
  refreshed: number;
  refreshFailed: number;
  snapshots: number;
  netWorthWritten: boolean;
  incomplete: boolean;
  transactionsSynced: number;
  transactionsFailed: number;
};

/**
 * The daily snapshot for one owner. It refreshes cached balances for every
 * active Item (a failing Item keeps its last stored balance and the run
 * continues), then in one transaction writes a balance_snapshots row per
 * account with a known balance and one net_worth_daily row for the date. Both
 * writes are upserts, so a repeated or late cron run overwrites rather than
 * duplicates. With no account holding a known balance no net-worth row is
 * written: unknown is not zero.
 *
 * Last, it runs a transactions sync for every active Item. Plaid sends
 * SYNC_UPDATES_AVAILABLE only after /transactions/sync has been called once
 * for an Item, so an Item that has never synced would otherwise wait forever;
 * for one that has, this catches up anything a lost webhook missed. It runs
 * after the net-worth write so a slow or failing sync never costs the day's
 * row.
 *
 * Vercel Hobby cron can fire up to an hour after its schedule, so `date` is
 * taken when the job actually runs, in the owner's timezone.
 */
export function createSnapshotService(deps: {
  repo: SyncRepo;
  sync: SyncService;
  timeZone: string;
  now?: () => Date;
}) {
  const { repo, sync, timeZone } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async run(ownerId: string): Promise<SnapshotResult> {
      const date = dateInTimezone(timeZone, now());
      let refreshed = 0;
      let refreshFailed = 0;
      const active = (await repo.listItems(ownerId)).filter((i) => i.status === "active");
      for (const item of active) {
        try {
          const r = await sync.refreshBalances(ownerId, item.id);
          if (r.ok) refreshed += 1;
          else refreshFailed += 1;
        } catch (err) {
          logException("snapshot_refresh_failed", err, { itemRef: itemRef(item.id) });
          refreshFailed += 1;
        }
      }
      let incomplete = false;
      const written = await repo.writeSnapshots(ownerId, date, (accounts) => {
        const nw = computeNetWorth(accounts);
        incomplete = nw.incomplete;
        if (nw.countedAccounts === 0) return null;
        return {
          assetsCents: nw.assetsCents,
          liabilitiesCents: nw.liabilitiesCents,
          netWorthCents: nw.netWorthCents,
          incomplete: nw.incomplete,
        };
      });
      let transactionsSynced = 0;
      let transactionsFailed = 0;
      for (const item of active) {
        try {
          const r = await sync.syncTransactions(ownerId, item.id);
          if (r.ok) transactionsSynced += 1;
          else {
            logError("snapshot_transactions_failed", { code: r.code, itemRef: itemRef(item.id) });
            transactionsFailed += 1;
          }
        } catch (err) {
          logException("snapshot_transactions_failed", err, { itemRef: itemRef(item.id) });
          transactionsFailed += 1;
        }
      }
      return {
        date,
        refreshed,
        refreshFailed,
        ...written,
        incomplete,
        transactionsSynced,
        transactionsFailed,
      };
    },
  };
}

export type SnapshotService = ReturnType<typeof createSnapshotService>;
