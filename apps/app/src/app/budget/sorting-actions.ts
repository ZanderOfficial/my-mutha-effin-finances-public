"use server";
// Server actions behind sorting deposits and managing businesses on the Budget page.

import { withOwner } from "@/server/db";
import { ownerWrite as perform, type ActionState } from "@/server/owner-write";
import {
  addBusiness,
  removeBusiness,
  removeSourceRule,
  removeTransactionChoice,
  renameBusiness,
  setSourceRule,
  setTransactionChoice,
  setTransactionChoices,
} from "@/server/sorting/sorting";

/** Sorts a source: with "always" ticked it makes a rule, otherwise it decides only the ticked deposits. */
export async function markSourceAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const kind = form.get("kind");
  const businessId = form.get("businessId");
  const sorted = "Sorted. Its deposits are in the months below.";
  if (form.get("always") === "1") {
    return perform(
      (ownerId) => setSourceRule(withOwner, ownerId, { sourceKey: form.get("sourceKey"), kind, businessId }),
      sorted,
    );
  }
  return perform(
    (ownerId) => setTransactionChoices(withOwner, ownerId, { transactionIds: form.getAll("transactionId"), kind, businessId }),
    sorted,
  );
}

export async function removeSourceRuleAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return perform((ownerId) => removeSourceRule(withOwner, ownerId, form.get("ruleId")));
}

export async function markTransactionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return perform((ownerId) =>
    setTransactionChoice(withOwner, ownerId, {
      transactionId: form.get("transactionId"),
      kind: form.get("kind"),
      businessId: form.get("businessId"),
    }),
  );
}

export async function removeTransactionChoiceAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  return perform((ownerId) => removeTransactionChoice(withOwner, ownerId, form.get("transactionId")));
}

export async function addBusinessAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return perform((ownerId) => addBusiness(withOwner, ownerId, form.get("name")));
}

export async function renameBusinessAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return perform((ownerId) => renameBusiness(withOwner, ownerId, form.get("businessId"), form.get("name")));
}

export async function removeBusinessAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return perform((ownerId) => removeBusiness(withOwner, ownerId, form.get("businessId")));
}
