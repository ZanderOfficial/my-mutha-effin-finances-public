import { getPlaidProvider } from "@/server/plaid";
import { createInstitutionRepo } from "./repository";
import { createInstitutionService, type InstitutionService } from "./service";

export { InstitutionServiceError } from "./service";

/** Throws PlaidConfigError (fail closed) when Plaid is not configured safely. */
export function getInstitutionService(): InstitutionService {
  return createInstitutionService({
    plaid: getPlaidProvider(),
    repo: createInstitutionRepo(),
  });
}
