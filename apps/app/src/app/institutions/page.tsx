import { EmptyState } from "@/components/EmptyState";
import { InstitutionCard } from "@/components/institutions/InstitutionCard";
import { LinkInstitutionButton } from "@/components/institutions/LinkActions";
import { getOwnerId } from "@/server/auth";
import { isDatabaseConfigured } from "@/server/db";
import {
  institutionReads,
  MAX_LINKED_ITEMS,
  type InstitutionView,
} from "@/server/institutions/reads";

// Reads per-owner data: it must render per request, never at build time.
export const dynamic = "force-dynamic";

async function loadInstitutions(): Promise<{
  ownerId: string | null;
  institutions: InstitutionView[];
}> {
  const ownerId = await getOwnerId();
  if (!ownerId || !isDatabaseConfigured()) return { ownerId, institutions: [] };
  return { ownerId, institutions: await institutionReads.list(ownerId) };
}

export default async function InstitutionsPage() {
  const { ownerId, institutions } = await loadInstitutions();
  const canLink =
    ownerId !== null && isDatabaseConfigured() && institutions.length < MAX_LINKED_ITEMS;

  return (
    <main id="main" className="flex-1 px-6 py-10 sm:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl font-black">My Institutions</h1>
          <p className="mt-1 text-base text-muted">
            {institutions.length} of {MAX_LINKED_ITEMS} linked.
          </p>
        </div>
        {canLink && <LinkInstitutionButton />}
      </div>

      <div className="mt-8">
        {institutions.length === 0 ? (
          <EmptyState title="Link your first institution">
            Linking runs through Plaid. You sign in on Plaid&apos;s own screen,
            never ours, and we keep only the connection token and a truncated
            account number.
          </EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {institutions.map((i) => (
              <InstitutionCard key={i.id} institution={i} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
