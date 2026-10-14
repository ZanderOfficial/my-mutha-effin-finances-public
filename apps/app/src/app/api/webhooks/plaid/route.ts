import { after } from "next/server";
import { DatabaseNotConfiguredError } from "@/server/db";
import { PlaidConfigError } from "@/server/plaid/errors";
import { handlePlaidWebhook } from "@/server/webhooks/plaid-webhook";
import { logException } from "@/server/log";
import { getWebhookDeps } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Plaid webhook receiver. Signature verification happens inside the handler
 * before any parsing or database access; processing runs in `after()` so the
 * 200 goes back inside Plaid's 10 second window.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    return await handlePlaidWebhook(request, getWebhookDeps((work) => after(work)));
  } catch (err) {
    if (err instanceof PlaidConfigError || err instanceof DatabaseNotConfiguredError) {
      logException("webhook_not_configured", err, { status: 503 });
      return Response.json({ error: "Service is not configured" }, { status: 503 });
    }
    logException("webhook_failed", err, { status: 500 });
    // A non-200 makes Plaid retry for up to 24 hours, which is what we want here.
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
