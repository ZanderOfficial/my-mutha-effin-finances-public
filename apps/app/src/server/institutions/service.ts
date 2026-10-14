import {
  decryptToken,
  encryptToken,
  type EncryptedToken,
} from "@/server/crypto/tokens";
import { PlaidApiError } from "@/server/plaid/errors";
import type { PlaidProvider } from "@/server/plaid/types";
import {
  ItemCapReachedError,
  MAX_LINKED_ITEMS,
  toAccountRow,
  type InstitutionRepo,
  type ItemStatus,
} from "./repository";

export type ServiceErrorKind = "cap_reached" | "not_found" | "plaid";

export class InstitutionServiceError extends Error {
  constructor(
    readonly kind: ServiceErrorKind,
    message: string,
    readonly plaid?: PlaidApiError,
  ) {
    super(message);
    this.name = "InstitutionServiceError";
  }
}

export type ServiceDeps = {
  plaid: PlaidProvider;
  repo: InstitutionRepo;
  encrypt?: (plaintext: string) => EncryptedToken;
  decrypt?: (ciphertext: Uint8Array) => string;
};

/** What the browser may learn about a freshly linked institution. */
export type LinkedSummary = {
  id: string;
  institutionName: string | null;
  status: ItemStatus;
  accountCount: number;
};

const MAX_NAME = 100;

function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const t = name.trim().slice(0, MAX_NAME);
  return t === "" ? null : t;
}

function statusFor(errorCode: string | null): ItemStatus {
  return errorCode === "ITEM_LOGIN_REQUIRED" ? "needs_reauth" : "active";
}

/**
 * Orchestrates Plaid and persistence. It owns the ordering rules: the cap is
 * checked before anything is exchanged, the access token is encrypted before
 * it reaches the repository, and it is decrypted only immediately before a
 * Plaid call. Nothing here returns or logs a token.
 */
export function createInstitutionService(deps: ServiceDeps) {
  const { plaid, repo } = deps;
  const encrypt = deps.encrypt ?? ((p: string) => encryptToken(p));
  const decrypt = deps.decrypt ?? ((c: Uint8Array) => decryptToken(c));

  async function plaidCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PlaidApiError) {
        throw new InstitutionServiceError("plaid", err.message, err);
      }
      throw err;
    }
  }

  async function secretFor(ownerId: string, itemId: string) {
    const secret = await repo.getItemSecret(ownerId, itemId);
    if (!secret) throw new InstitutionServiceError("not_found", "Institution not found");
    return secret;
  }

  /** Best effort: stop Plaid billing for an Item we could not store. */
  async function discard(accessToken: string): Promise<void> {
    try {
      await plaid.removeItem(accessToken);
    } catch {
      // Nothing more to do; the original failure is the one worth surfacing.
    }
  }

  return {
    async startLink(ownerId: string): Promise<{ linkToken: string }> {
      if ((await repo.countItems(ownerId)) >= MAX_LINKED_ITEMS) {
        throw new InstitutionServiceError(
          "cap_reached",
          `At most ${MAX_LINKED_ITEMS} institutions can be linked`,
        );
      }
      const { linkToken } = await plaidCall(() => plaid.createLinkToken({ ownerId }));
      return { linkToken };
    },

    async startReconnect(ownerId: string, itemId: string): Promise<{ linkToken: string }> {
      const secret = await secretFor(ownerId, itemId);
      const accessToken = decrypt(secret.accessTokenEnc);
      const { linkToken } = await plaidCall(() =>
        plaid.createUpdateLinkToken({ ownerId, accessToken }),
      );
      return { linkToken };
    },

    /** Exchanges the public token, stores the Item encrypted, ingests its accounts. */
    async completeLink(
      ownerId: string,
      input: { publicToken: string; institutionName?: string | null },
    ): Promise<LinkedSummary> {
      if ((await repo.countItems(ownerId)) >= MAX_LINKED_ITEMS) {
        throw new InstitutionServiceError(
          "cap_reached",
          `At most ${MAX_LINKED_ITEMS} institutions can be linked`,
        );
      }
      const exchanged = await plaidCall(() => plaid.exchangePublicToken(input.publicToken));
      const { accessToken, itemId } = exchanged;
      try {
        const token = encrypt(accessToken);
        const [item, accounts] = await plaidCall(() =>
          Promise.all([plaid.getItem(accessToken), plaid.getAccounts(accessToken)]),
        );
        const status = statusFor(item.errorCode);
        const id = await repo.saveItem(ownerId, {
          plaidItemId: itemId,
          token,
          institutionId: item.institutionId,
          institutionName: item.institutionName ?? cleanName(input.institutionName),
          status,
          lastErrorCode: item.errorCode,
          accounts: accounts.map(toAccountRow),
        });
        return {
          id,
          institutionName: item.institutionName ?? cleanName(input.institutionName),
          status,
          accountCount: accounts.length,
        };
      } catch (err) {
        await discard(accessToken);
        if (err instanceof ItemCapReachedError) {
          throw new InstitutionServiceError("cap_reached", err.message);
        }
        throw err;
      }
    },

    /**
     * Re-reads Item status and cached balances. Used after an update-mode Link
     * succeeds (to clear needs_reauth) and available for manual refresh.
     */
    async refreshItem(ownerId: string, itemId: string): Promise<{ status: ItemStatus }> {
      const secret = await secretFor(ownerId, itemId);
      const accessToken = decrypt(secret.accessTokenEnc);
      try {
        const item = await plaid.getItem(accessToken);
        const status = statusFor(item.errorCode);
        const accounts =
          status === "active" && item.errorCode === null
            ? (await plaid.getAccounts(accessToken)).map(toAccountRow)
            : null;
        await repo.updateItemFromPlaid(ownerId, itemId, {
          status,
          lastErrorCode: item.errorCode,
          accounts,
        });
        return { status };
      } catch (err) {
        if (err instanceof PlaidApiError) {
          if (err.isLoginRequired) {
            await repo.markNeedsReauth(ownerId, itemId, err.code);
            return { status: "needs_reauth" };
          }
          throw new InstitutionServiceError("plaid", err.message, err);
        }
        throw err;
      }
    },

    /**
     * Removes the Item at Plaid first (stops billing), then deletes our rows.
     * If Plaid fails for any reason other than "already gone", the rows stay,
     * so a billed Item is never orphaned.
     */
    async unlink(ownerId: string, itemId: string): Promise<void> {
      const secret = await secretFor(ownerId, itemId);
      const accessToken = decrypt(secret.accessTokenEnc);
      try {
        await plaid.removeItem(accessToken);
      } catch (err) {
        if (!(err instanceof PlaidApiError) || err.code !== "ITEM_NOT_FOUND") {
          if (err instanceof PlaidApiError) {
            throw new InstitutionServiceError("plaid", err.message, err);
          }
          throw err;
        }
      }
      await repo.deleteItem(ownerId, itemId);
    },
  };
}

export type InstitutionService = ReturnType<typeof createInstitutionService>;
