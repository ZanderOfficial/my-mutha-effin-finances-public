import { OAuthReturn } from "@/components/institutions/OAuthReturn";
import { requireOwner } from "@/server/auth";

// Per request and per owner: never prerendered. The path (/oauth/plaid) is the
// one registered with Plaid as the redirect URI; see src/lib/plaid-oauth.ts.
export const dynamic = "force-dynamic";

export default async function OAuthReturnPage() {
  // The owner is the person returning from their bank. A signed-out visitor,
  // or one who is not the owner, is sent to sign-in and learns nothing.
  await requireOwner();

  return (
    <main id="main" className="flex-1 px-6 py-10 sm:px-10">
      <h1 className="font-display text-5xl font-black">Linking your bank</h1>
      <div className="mt-8">
        <OAuthReturn />
      </div>
    </main>
  );
}
