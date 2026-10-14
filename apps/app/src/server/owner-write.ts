// The one path every Budget page form takes: check the owner, write, refresh the page, answer in words.
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireOwner } from "@/server/auth";
import { DatabaseNotConfiguredError } from "@/server/db";
import { logException } from "@/server/log";
import type { WriteResult } from "@/server/write-result";

/** What a form shows after it posts. */
export type ActionState = { status: "idle" | "saved" | "error"; message: string };

/**
 * Checks the owner first, runs the change, and refreshes the Budget page on success.
 * A failed write answers in words instead of replacing the page, so other rows keep what the owner typed.
 */
export async function ownerWrite(
  change: (ownerId: string) => Promise<WriteResult>,
  savedMessage = "Saved.",
): Promise<ActionState> {
  const ownerId = await requireOwner();
  try {
    const result = await change(ownerId);
    if (!result.ok) return { status: "error", message: result.message };
    revalidatePath("/budget");
    return { status: "saved", message: savedMessage };
  } catch (err) {
    // Next's own redirect and not-found signals must still reach Next.
    unstable_rethrow(err);
    if (err instanceof DatabaseNotConfiguredError) {
      return { status: "error", message: "Saving is not set up on this server." };
    }
    // Class name and code only: a driver message can carry a query or a value.
    logException("budget.write_failed", err);
    return { status: "error", message: "Could not save. Try again." };
  }
}
