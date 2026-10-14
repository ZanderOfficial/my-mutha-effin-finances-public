"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PlaidLauncher } from "./PlaidLauncher";

async function postJson(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Request failed.");
  }
}

const NEW_LINK = { kind: "new" } as const;

export function LinkInstitutionButton() {
  const router = useRouter();
  return (
    <PlaidLauncher
      label="+ Link an institution"
      tokenUrl="/api/plaid/link-token"
      session={NEW_LINK}
      className="inline-flex min-h-11 items-center border-2 border-income px-6 text-base font-bold glow-income-sm disabled:opacity-60"
      onLinked={async (publicToken, metadata) => {
        await postJson("/api/plaid/exchange", {
          public_token: publicToken,
          institution: metadata.institution
            ? {
                name: metadata.institution.name,
                institution_id: metadata.institution.institution_id,
              }
            : undefined,
        });
        router.refresh();
      }}
    />
  );
}

export function ReconnectButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const session = useMemo(() => ({ kind: "update", itemId }) as const, [itemId]);
  return (
    <PlaidLauncher
      label="Reconnect"
      tokenUrl={`/api/plaid/items/${itemId}/reconnect`}
      session={session}
      className="inline-flex min-h-11 items-center border-2 border-spending px-5 text-base font-bold glow-spending-sm disabled:opacity-60"
      onLinked={async () => {
        // Update mode returns no exchange: re-read the Item to clear needs_reauth.
        await postJson(`/api/plaid/items/${itemId}/refresh`);
        router.refresh();
      }}
    />
  );
}

export function UnlinkButton({ itemId, name }: { itemId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plaid/items/${itemId}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not unlink.");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlink.");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-muted underline underline-offset-4 hover:text-foreground"
      >
        Unlink
      </button>
    );
  }

  return (
    <div role="group" aria-label={`Confirm unlinking ${name}`} className="flex flex-col gap-2">
      <p className="max-w-sm text-sm text-muted">
        Unlink {name}? Plaid stops syncing it and its accounts are deleted here.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={unlink}
          disabled={busy}
          className="inline-flex min-h-11 items-center border-2 border-spending px-4 text-sm font-bold disabled:opacity-60"
        >
          {busy ? "Unlinking…" : "Yes, unlink"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="inline-flex min-h-11 items-center border-2 border-rule px-4 text-sm font-semibold"
        >
          Cancel
        </button>
      </div>
      {error && (
        <span role="alert" className="text-sm text-spending">
          ! {error}
        </span>
      )}
    </div>
  );
}
