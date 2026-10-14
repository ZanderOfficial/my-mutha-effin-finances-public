"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  { href: "/overview", label: "Overview" },
  { href: "/budget", label: "Budget" },
  { href: "/transactions", label: "Transactions" },
  { href: "/net-worth", label: "Net worth" },
  { href: "/institutions", label: "My Institutions" },
] as const;

/**
 * A count for a tab badge (Items needing reconnecting, transactions in Misc),
 * or null when unknown (signed out, not configured, request failed). Fetched
 * on the client so the layout and the pages that read no data stay static.
 */
function useCount(url: string, field: string, pathname: string, skip: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    fetch(url, { cache: "no-store", redirect: "manual" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: Record<string, unknown> | null) => {
        if (cancelled) return;
        const value = body?.[field];
        setCount(typeof value === "number" ? value : null);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, field, pathname, skip]);
  return skip ? null : count;
}

export function AppHeader() {
  const pathname = usePathname();
  const signedOutView = pathname.startsWith("/auth");
  const needsReauth = useCount("/api/plaid/status", "needs_reauth", pathname, signedOutView);
  const misc = useCount("/api/budget/misc", "misc", pathname, signedOutView);

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule px-6 sm:px-10">
      <Link
        href="/overview"
        className="py-4 font-display text-[26px] font-black tracking-wider"
      >
        MMFF
      </Link>
      {!signedOutView && (
      <nav
        aria-label="Main"
        className="flex min-w-0 flex-1 basis-[520px] gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const current = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-14 items-center whitespace-nowrap border-b-[3px] px-4 text-[15px] font-semibold ${
                current
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.href === "/budget" && misc ? (
                <span
                  className="ml-2 rounded-full border border-foreground px-2 text-[13px] font-bold"
                  title={`${misc} to sort in Misc`}
                >
                  <span aria-hidden="true">{misc}</span>
                  <span className="sr-only">{misc} to sort in Misc</span>
                </span>
              ) : null}
              {tab.href === "/institutions" && needsReauth ? (
                <span
                  className="ml-2 rounded-full border border-spending px-2 text-[13px] font-bold text-spending"
                  title={`${needsReauth} need reconnecting`}
                >
                  <span aria-hidden="true">!{needsReauth}</span>
                  <span className="sr-only">{needsReauth} need reconnecting</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      )}
    </header>
  );
}
