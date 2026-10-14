import type { NextConfig } from "next";
import { securityHeaderRules } from "./security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // The Content-Security-Policy is not here: it carries a per-request nonce,
    // so src/proxy.ts sets it.
    return securityHeaderRules();
  },
};

export default nextConfig;
