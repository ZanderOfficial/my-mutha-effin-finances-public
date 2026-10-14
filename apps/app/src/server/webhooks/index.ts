import { getPlaidProvider } from "@/server/plaid";
import { createSyncRepo } from "@/server/sync/repository";
import { createSyncService } from "@/server/sync/service";
import { createEventProcessor } from "./processor";
import { createEventsRepo } from "./repository";
import { createKeyCache, verifyPlaidWebhook } from "./verify";
import type { WebhookDeps } from "./plaid-webhook";

let keyCache: ReturnType<typeof createKeyCache> | undefined;

/**
 * Real wiring for the webhook route. Throws PlaidConfigError when Plaid is not
 * configured (the route answers 503). The key cache lives for the process.
 */
export function getWebhookDeps(schedule: WebhookDeps["schedule"]): WebhookDeps {
  const plaid = getPlaidProvider();
  const repo = createSyncRepo();
  const events = createEventsRepo();
  const sync = createSyncService({ plaid, repo });
  const processor = createEventProcessor({ events, repo, sync });
  keyCache ??= createKeyCache((kid) => plaid.getWebhookVerificationKey(kid));
  const getKey = keyCache;
  return {
    verify: (rawBody, token) => verifyPlaidWebhook({ rawBody, token, getKey }),
    repo,
    events,
    process: (ownerId, eventId) => processor.process(ownerId, eventId),
    schedule,
  };
}
