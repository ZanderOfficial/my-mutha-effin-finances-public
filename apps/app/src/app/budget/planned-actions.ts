"use server";
// Server actions behind the planned budget on the Budget page.

import { withOwner } from "@/server/db";
import { ownerWrite, type ActionState } from "@/server/owner-write";
import { addSubItem, createItem, deleteItem, setItemStatus, updateItem } from "@/server/planned/planned";
import {
  addStartingCategories,
  addTaxCategory,
  mapTaxCategory,
  removeTaxCategory,
  renameTaxCategory,
} from "@/server/planned/tax-categories";

export async function createItemAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite(
    (ownerId) =>
      createItem(withOwner, ownerId, {
        name: form.get("name"),
        amount: form.get("amount"),
        frequency: form.get("frequency"),
        notes: form.get("notes"),
        taxCategoryId: form.get("taxCategoryId"),
        businessIds: form.getAll("businessId"),
      }),
    "Added.",
  );
}

export async function addSubItemAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite(
    (ownerId) =>
      addSubItem(withOwner, ownerId, {
        parentId: form.get("parentId"),
        name: form.get("name"),
        amount: form.get("amount"),
        notes: form.get("notes"),
        taxCategoryId: form.get("taxCategoryId"),
      }),
    "Added.",
  );
}

export async function updateItemAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite((ownerId) =>
    updateItem(withOwner, ownerId, {
      itemId: form.get("itemId"),
      name: form.get("name"),
      amount: form.get("amount"),
      frequency: form.get("frequency"),
      notes: form.get("notes"),
      taxCategoryId: form.get("taxCategoryId"),
      businessIds: form.getAll("businessId"),
    }),
  );
}

export async function setItemStatusAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite((ownerId) => setItemStatus(withOwner, ownerId, { itemId: form.get("itemId"), status: form.get("status") }));
}

export async function deleteItemAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite(
    (ownerId) => deleteItem(withOwner, ownerId, { itemId: form.get("itemId"), withSubItems: form.get("withSubItems") }),
    "Deleted.",
  );
}

export async function addTaxCategoryAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite((ownerId) => addTaxCategory(withOwner, ownerId, form.get("name")), "Added.");
}

export async function renameTaxCategoryAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite((ownerId) => renameTaxCategory(withOwner, ownerId, form.get("categoryId"), form.get("name")));
}

export async function removeTaxCategoryAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite((ownerId) => removeTaxCategory(withOwner, ownerId, form.get("categoryId")), "Removed.");
}

export async function mapTaxCategoryAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return ownerWrite(
    (ownerId) => mapTaxCategory(withOwner, ownerId, { categoryId: form.get("categoryId"), mapping: form.get("mapping") }),
    "Mapping saved.",
  );
}

export async function addStartingCategoriesAction(): Promise<ActionState> {
  return ownerWrite((ownerId) => addStartingCategories(withOwner, ownerId), "Your categories were added. Check each proposed line.");
}
