import { createInstitutionRepo } from "./repository";

export { MAX_LINKED_ITEMS } from "./repository";
export type { InstitutionView, AccountView, ItemStatus } from "./repository";

const repo = createInstitutionRepo();

/** Read side used by the screens and the header badge. No Plaid SDK import. */
export const institutionReads = {
  list: (ownerId: string) => repo.listInstitutions(ownerId),
  countNeedsReauth: (ownerId: string) => repo.countNeedsReauth(ownerId),
};
