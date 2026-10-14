"use server";
// Server actions behind sorting spending into the planned budget, from the Misc pile and from a line item's matches.

import { withOwner } from "@/server/db";
import { ownerWrite, type ActionState } from "@/server/owner-write";
import { addOneTimeKind, removeOneTimeKind, renameOneTimeKind } from "@/server/sorting/one-time-kinds";
import { makeItemFromSpending, matchSpending, sortCharges, type Scope } from "@/server/sorting/spending";
import { fail } from "@/server/write-result";

/**
 * With "always" ticked the merchant gets a rule; otherwise only the ticked transactions are decided.
 * Each charge's own "each:<id>" choice is "same" (goes with the merchant), "skip" (stays in Misc),
 * or a line item's id, "out" or "one" (goes there on its own).
 */
function scopeOf(form: FormData): Scope {
  const always = form.get("always") === "1";
  const picks = [...form.entries()].flatMap(([name, value]) => (name.startsWith("each:") ? [{ transactionId: name.slice(5), target: value }] : []));
  const same = picks.filter((pick) => pick.target === "same").map((pick) => pick.transactionId);
  return {
    sourceKey: form.get("sourceKey"),
    always,
    transactionIds: [...form.getAll("transactionId"), ...(always ? [] : same)],
    each: picks.filter((pick) => pick.target !== "same" && pick.target !== "skip"),
  };
}

/** Moves transactions, or a whole merchant, to a line item ("target" is its id), out of budget ("out") or one-time ("one"). */
export async function matchSpendingAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite(
    (ownerId) =>
      matchSpending(withOwner, ownerId, {
        ...scopeOf(form),
        target: form.get("target"),
        businessId: form.get("businessId"),
        taxCategoryId: form.get("taxCategoryId"),
        oneTimeKindId: form.get("oneTimeKindId"),
      }),
    "Sorted.",
  );
}

/**
 * The Misc prompt's one form per merchant, with three buttons named "do": add to a line item,
 * make a new line item from it, or mark it out of budget or one-time. Each section's fields carry its prefix.
 */
export async function sortMerchantAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const scope = scopeOf(form);
  const choice = form.get("do");
  return ownerWrite((ownerId) => {
    if (choice === "item") {
      return matchSpending(withOwner, ownerId, { ...scope, target: form.get("itemTarget"), businessId: null, taxCategoryId: null });
    }
    if (choice === "transfer") {
      return matchSpending(withOwner, ownerId, { ...scope, target: "transfer", businessId: null, taxCategoryId: null });
    }
    // Out of budget and one-time share the For and tax category fields.
    if (choice === "out" || choice === "one") {
      return matchSpending(withOwner, ownerId, {
        ...scope,
        target: choice,
        businessId: form.get("outBusinessId"),
        taxCategoryId: form.get("outTaxCategoryId"),
        oneTimeKindId: choice === "one" ? form.get("outOneTimeKindId") : null,
      });
    }
    if (choice === "new") {
      return makeItemFromSpending(withOwner, ownerId, {
        ...scope,
        name: form.get("newName"),
        amount: form.get("newAmount"),
        frequency: form.get("newFrequency"),
        notes: "",
        taxCategoryId: form.get("newTaxCategoryId"),
        businessIds: form.getAll("newBusinessId"),
      });
    }
    // No choice for the merchant, but single charges were each given a place.
    if (!scope.always && scope.transactionIds.length === 0 && (scope.each?.length ?? 0) > 0) {
      return sortCharges(withOwner, ownerId, scope.each ?? []);
    }
    return Promise.resolve(fail("Choose what to do with this merchant."));
  }, "Sorted. Its spending is matched below.");
}

/** The owner's one-time kinds, kept beside Businesses on the Ledger. */
export async function addOneTimeKindAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite((ownerId) => addOneTimeKind(withOwner, ownerId, form.get("name")));
}

export async function renameOneTimeKindAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite((ownerId) => renameOneTimeKind(withOwner, ownerId, form.get("kindId"), form.get("name")));
}

export async function removeOneTimeKindAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite((ownerId) => removeOneTimeKind(withOwner, ownerId, form.get("kindId")));
}
