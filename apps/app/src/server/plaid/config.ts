import { OAUTH_RETURN_PATH } from "@/lib/plaid-oauth";
import { PlaidConfigError } from "./errors";

export type PlaidEnvName = "sandbox" | "production";

export type PlaidConfig = {
  clientId: string;
  secret: string;
  env: PlaidEnvName;
  webhookUrl: string | null;
  /** Registered OAuth return address, or null when OAuth banks are not enabled. */
  redirectUri: string | null;
};

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Validates PLAID_REDIRECT_URI against Plaid's rules for web OAuth
 * (plaid.com/docs/link/oauth/): HTTPS only, except plain http to a loopback
 * host in Sandbox; no query string, no fragment (hash routing is
 * unsupported), no wildcard (wildcards belong only in the Dashboard
 * allowlist), no credentials. The path must be the return page this app
 * serves, otherwise the bank would send the owner to a 404. Returns the
 * normalised value. Error messages name the variable, never its value.
 */
export function parseRedirectUri(raw: string, env: PlaidEnvName): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PlaidConfigError("PLAID_REDIRECT_URI must be an absolute URL");
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol === "http:") {
    if (!(env === "sandbox" && loopback)) {
      throw new PlaidConfigError(
        "PLAID_REDIRECT_URI must use https (http is allowed only for localhost in sandbox)",
      );
    }
  } else if (url.protocol !== "https:") {
    throw new PlaidConfigError("PLAID_REDIRECT_URI must use https");
  }
  if (url.username || url.password) {
    throw new PlaidConfigError("PLAID_REDIRECT_URI must not contain credentials");
  }
  if (url.search || url.hash || raw.includes("?") || raw.includes("#")) {
    throw new PlaidConfigError("PLAID_REDIRECT_URI must not have a query string or fragment");
  }
  if (raw.includes("*")) {
    throw new PlaidConfigError("PLAID_REDIRECT_URI must not contain a wildcard");
  }
  if (url.pathname !== OAUTH_RETURN_PATH) {
    throw new PlaidConfigError(`PLAID_REDIRECT_URI must end with ${OAUTH_RETURN_PATH}`);
  }
  return `${url.origin}${url.pathname}`;
}

/**
 * Validates Plaid configuration and fails closed: missing keys, an unknown
 * PLAID_ENV, or `production` without MMFF_ALLOW_PLAID_PRODUCTION=true all
 * throw. Switching to production is the owner's decision in the Vercel
 * dashboard; the second flag makes a stray PLAID_ENV=production harmless.
 * Error messages name variables, never values.
 */
export function loadPlaidConfig(env: Env = process.env): PlaidConfig {
  const clientId = env.PLAID_CLIENT_ID?.trim();
  const secret = env.PLAID_SECRET?.trim();
  if (!clientId || !secret) {
    throw new PlaidConfigError("PLAID_CLIENT_ID and PLAID_SECRET must be set");
  }
  const rawEnv = (env.PLAID_ENV ?? "").trim();
  if (rawEnv !== "sandbox" && rawEnv !== "production") {
    throw new PlaidConfigError("PLAID_ENV must be sandbox or production");
  }
  if (rawEnv === "production" && env.MMFF_ALLOW_PLAID_PRODUCTION !== "true") {
    throw new PlaidConfigError(
      "PLAID_ENV=production is refused unless MMFF_ALLOW_PLAID_PRODUCTION=true is also set",
    );
  }
  const webhook = env.PLAID_WEBHOOK_URL?.trim();
  const redirect = env.PLAID_REDIRECT_URI?.trim();
  return {
    clientId,
    secret,
    env: rawEnv,
    webhookUrl: webhook ? webhook : null,
    redirectUri: redirect ? parseRedirectUri(redirect, rawEnv) : null,
  };
}

export function isPlaidConfigured(env: Env = process.env): boolean {
  try {
    loadPlaidConfig(env);
    return true;
  } catch {
    return false;
  }
}
