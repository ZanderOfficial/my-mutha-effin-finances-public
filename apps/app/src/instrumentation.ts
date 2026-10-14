import type { Instrumentation } from "next";

/**
 * Routes Next's server-side request errors through the allowlisted logger.
 * Next itself reports a failed render, route or action to this hook; we
 * record only the exception's class name and a string `code`, never its
 * message, the request path or headers (a path can carry an item id, and a
 * message can carry a query or a value). The runtime check keeps the Node-only
 * logger out of the edge bundle.
 */
export const onRequestError: Instrumentation.onRequestError = async (err) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logException } = await import("@/server/log");
  logException("request_error", err, { status: 500 });
};
