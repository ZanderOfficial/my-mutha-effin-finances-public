import { loadPlaidConfig } from "./config";
import { createPlaidProvider } from "./sdk-provider";
import type { PlaidProvider } from "./types";

export type { PlaidProvider, PlaidAccountInfo, PlaidItemInfo } from "./types";
export { PlaidApiError, PlaidConfigError, normalisePlaidError } from "./errors";
export { isPlaidConfigured, loadPlaidConfig } from "./config";

let cached: PlaidProvider | undefined;

/** Throws PlaidConfigError (fail closed) when configuration is missing or unsafe. */
export function getPlaidProvider(): PlaidProvider {
  if (!cached) cached = createPlaidProvider(loadPlaidConfig());
  return cached;
}
