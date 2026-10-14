// What a write returns, shared by every owner write so the form layer can answer in words.
import type { Queryable } from "@/server/db";

/** Done, or a plain sentence saying why not. */
export type WriteResult = { ok: true } | { ok: false; message: string };

/** `withOwner`, passed in so tests can run the same writes against PGlite. */
export type Run = <T>(ownerId: string, fn: (tx: Queryable) => Promise<T>) => Promise<T>;

export const OK: WriteResult = { ok: true };
export const fail = (message: string): WriteResult => ({ ok: false, message });
