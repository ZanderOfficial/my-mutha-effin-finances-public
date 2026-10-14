// The app's security headers. The fixed set is wired in next.config.ts; the CSP is set per request
// by src/proxy.ts because it carries a nonce. Kept apart so a unit test can read the exact values.

/** Plaid Link's script, per plaid.com/docs/link/web. */
export const PLAID_LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

/** The request header that carries the nonce to server components. */
export const NONCE_HEADER = "x-nonce";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** 128 random bits, base64. A fresh one for every request. */
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

export function contentSecurityPolicy({ isDev, nonce }: { isDev: boolean; nonce: string }): string {
  // The nonce is spliced into a header, so refuse anything that could end it.
  if (!BASE64.test(nonce)) throw new Error("CSP nonce must be base64");

  const directives = [
    "default-src 'self'",
    // Inline scripts only with this request's nonce; 'unsafe-eval' only for React's dev tools.
    // No 'strict-dynamic': it would switch off the allowlist that keeps Plaid's script the only third-party one.
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""} ${PLAID_LINK_SCRIPT}`,
    // Tailwind's style attributes and the charts' inline SVG styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // next/font self-hosts the fonts.
    "font-src 'self'",
    // Both Plaid API hosts: the build and the running environment can differ.
    "connect-src 'self' https://sandbox.plaid.com https://production.plaid.com",
    // Plaid Link's iframe.
    "frame-src https://cdn.plaid.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // Plain http://localhost must keep working in development.
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

export function securityHeaderRules(): HeaderRule[] {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value:
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
        },
      ],
    },
    // Financial JSON must never be cached by a browser, proxy or CDN.
    { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
  ];
}
