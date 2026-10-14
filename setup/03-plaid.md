# 03. Plaid

Why: Plaid is the service that connects to banks, credit cards and brokerages
and hands MMFF-App balances and transactions. The app uses three Plaid
products: Transactions, Liabilities and Investments (root `README.md`).

State today: M3 is built. The app can create Link tokens (new and update
mode), exchange a public token, store the Item encrypted, ingest accounts with
cached balances, reconnect a login-required Item and unlink. M4 adds the
signed webhook receiver at `/api/webhooks/plaid`, transaction sync, liabilities
and holdings ingestion, and the daily snapshot.

## Steps

1. Create a Plaid account at plaid.com and open the Dashboard.

2. Find your keys at https://dashboard.plaid.com/developers/keys. Plaid's
   quickstart (https://plaid.com/docs/quickstart/) says you have a `client_id`
   (identifies your team) and a separate `secret` for each of the two
   environments, Sandbox and Production.

3. Start in Sandbox. Sandbox uses fake institutions and test data supplied by
   Plaid, and Plaid's billing page says Sandbox is always free
   (https://plaid.com/docs/account/billing/). Put the Sandbox values in
   `apps/app/.env.local`:

```text
PLAID_CLIENT_ID=<your client_id>
PLAID_SECRET=<your Sandbox secret>
PLAID_ENV=sandbox
```

   The valid values the quickstart names are `sandbox` and `production`. Plaid
   has historically also had a `development` environment; the current
   quickstart does not mention it, so use only the two above. Never put a
   Production secret in a file on your laptop or in a chat.

4. Link a test institution. Plaid publishes test credentials at
   https://plaid.com/docs/sandbox/test-credentials/: username `user_good`,
   password `pass_good`, with First Platypus Bank (`ins_109508`) as the
   non-OAuth test institution, and `1234` as the code for every MFA device.
   These are Plaid's documented test values and are the only credentials you
   should ever type into Link during development. Link is built into My Institutions: sign in, open the tab and press
   "+ Link an institution". The only Plaid environment values the app accepts
   are `sandbox` and `production`, and `production` is refused unless
   `MMFF_ALLOW_PLAID_PRODUCTION=true` is also set.

## What M3 asks Plaid for

- New link: `products: [transactions]` with `transactions.days_requested: 730`
  (permanent for that Item), `optional_products: [liabilities, investments]`,
  and `webhook` from `PLAID_WEBHOOK_URL` when set. The `client_user_id` is
  derived from the owner id, never an email.
- Reconnect (update mode): `/link/token/create` with the Item's `access_token`
  and no products. After Link succeeds the app re-reads the Item to clear the
  `!` state.
- Balances come from `/accounts/get` (cached, no per-call charge). The billed
  `/accounts/balance/get` is never called.
- Unlinking calls `/item/remove` first, which stops billing for that Item.
- At most 10 institutions can be linked (a constant in
  `src/server/institutions/repository.ts`).

## Testing the link flow (owner steps)

1. Put the three Sandbox values from step 3 in `apps/app/.env.local`, plus the
   database, auth and `TOKEN_ENC_KEY` variables from `docs/LOCAL-DEV.md`.
2. `pnpm dev`, sign in as the owner, open My Institutions.
3. Press "+ Link an institution", choose First Platypus Bank, and use
   `user_good` / `pass_good` (MFA code `1234` if asked).
4. The institution card should show "Synced" and its accounts with masks and
   balances. Credit and loan accounts show a minus amount marked "owed".
5. To exercise reconnect, trigger a login-required state in Sandbox with
   `/sandbox/item/reset_login` (Plaid's sandbox docs), reload, and press
   Reconnect on the `!` card.
6. Press Unlink, confirm, and check the Dashboard shows the Item removed.

## Webhooks

A webhook is a message Plaid sends to your server when new data is ready. Per
Plaid (https://plaid.com/docs/api/webhooks/):

- The URL must be standard `http(s)` and, if HTTPS, must have a valid
  certificate. In practice that means a public address. `localhost` cannot
  receive webhooks, which is why this app is hosted on Vercel.
- You set the URL with the `webhook` parameter of `/link/token/create`. In this
  app the value comes from `PLAID_WEBHOOK_URL`, for example
  `https://<your-vercel-domain>/api/webhooks/plaid` The route exists as of M4.
- If your endpoint returns non-200 or does not answer within 10 seconds, Plaid
  retries for up to 24 hours with exponential backoff.
- In Sandbox you can trigger webhooks on demand with
  `/sandbox/item/fire_webhook`, so you do not have to wait for real events.

### How the app handles a webhook (M4)

1. The route reads the raw body and checks the `Plaid-Verification` JWT exactly
   as https://plaid.com/docs/api/webhooks/webhook-verification/ describes
   (ES256 only, public key fetched by `kid` and cached, issued within 5
   minutes, constant-time compare of the body SHA-256). Anything else is a
   401 and nothing is written.
2. The owner is found from the Plaid item id, the event is stored in
   `provider_events` (ids and codes only, unique on a hash so a redelivery is a
   no-op) and the route answers 200.
3. After the response a processor acts on the stored row:
   `SYNC_UPDATES_AVAILABLE` runs transaction sync; `HOLDINGS`,
   `INVESTMENTS_TRANSACTIONS` and `LIABILITIES` `DEFAULT_UPDATE` refresh those;
   `ITEM` `ERROR` with `ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION` and
   `PENDING_DISCONNECT` set the Item to needs-reauth; `LOGIN_REPAIRED` sets it
   active again and syncs; `USER_PERMISSION_REVOKED` marks it revoked.

### Owner steps to test webhooks in Sandbox

1. Deploy a Preview (or Production with Sandbox keys) per step 04, with
   `PLAID_WEBHOOK_URL=https://<that-domain>/api/webhooks/plaid`, `CRON_SECRET`
   and the database and auth variables set, and migration 0004 applied. The
   webhook URL is attached to an Item when its Link token is created, so link
   an Item after setting it (or unlink and relink an existing one).
2. Link First Platypus Bank (`user_good` / `pass_good`). Plaid sends an initial
   `SYNC_UPDATES_AVAILABLE` when the first pull is ready; check the
   transactions appear.
3. To fire one yourself use `/sandbox/item/fire_webhook` (see Plaid sandbox
   docs) with `webhook_code` `SYNC_UPDATES_AVAILABLE` and the Item's
   `access_token`. The app keeps that token encrypted, so make a throwaway
   sandbox Item directly through Plaid's API for this check rather than
   extracting one. Then confirm one `provider_events` row with `processed_at`
   set.
4. Fire `ITEM` / `ERROR` carrying `ITEM_LOGIN_REQUIRED` (or call
   `/sandbox/item/reset_login`) and confirm the card turns to needs-reauth.
5. Signed in as the owner, `POST /api/plaid/items/<id>/sync` runs the same
   ingest by hand, with no webhook needed.

Testing webhooks before you deploy: Plaid's pages above do not describe a
local tunnel workflow, so this guide does not recommend one. Use your Vercel
Preview deployment (step 04) with Sandbox keys instead.

## Free tier, Trial and production access (what is uncertain)

Plaid changes plans and limits over time. The billing page
(https://plaid.com/docs/account/billing/) currently describes a Trial plan for
new US and Canada teams, a Pay-as-you-go plan and a Growth plan, all of which
give Production access, and states a cap on Production Items for Trial. This
guide does not repeat figures. Before you rely on real banks:

- Read the billing page and https://plaid.com/pricing/ and confirm what applies
  to your team.
- In the Dashboard, confirm your plan and whether Production access is granted
  or must be requested. The owner's notes in `docs/LOCAL-DEV.md` list this as
  something to confirm in the Dashboard.
- Remember Plaid's warning on that page that removing Trial Items does not
  restore your allowance.

## OAuth institutions (many large banks)

Plaid's OAuth guide (https://plaid.com/docs/link/oauth/) says Production
access is a prerequisite for OAuth institutions, and you must also complete the
compliance registration in the Dashboard (application details, company
details, agreement and security questionnaire) and wait for Plaid's approval.
Sandbox can test OAuth even before that, using Platypus OAuth Bank
(`ins_127287`). Whether OAuth banks work on a Trial plan is not something this
guide could confirm; check the Dashboard.

### How the app supports OAuth (issue #13)

For an OAuth bank, Link sends the browser to the bank's own site and the bank
sends it back to a `redirect_uri` you registered. Plaid then requires the page
at that address to reopen Link with the same link token and the URL it was
sent to (`receivedRedirectUri`). The app does this at `/oauth/plaid`:

- `PLAID_REDIRECT_URI` (name only in `.env.example`) is sent as `redirect_uri`
  when a Link token is created, for a new link and for a reconnect. Unset, it is
  left out and only banks that take a username and password will link.
- The value must be `https` and end in exactly `/oauth/plaid`, with no query
  string, fragment or wildcard. `http://localhost:3100/oauth/plaid` is allowed
  only with `PLAID_ENV=sandbox`. Anything else is refused when the linking
  routes load the configuration (503), and the message names the variable,
  never the value.
- Register the same address in the Plaid Dashboard, under "Allowed redirect
  URIs" (https://dashboard.plaid.com/developers/api). Plaid rejects a Link token
  whose `redirect_uri` is not on the list.
- Because Link is reopened after a full-page navigation, the short-lived link
  token is kept in the browser's `localStorage` for that one session, as
  Plaid's own example does. It is not the access token, the app drops it after
  30 minutes and clears it the moment Link finishes, and it is never logged.
  When Link succeeds the page calls the same exchange route as a normal link
  (or the refresh route for a reconnect) and returns to My Institutions.
- The return page stays behind sign-in. If your session expired during the
  bank trip you are sent to sign-in and the link has to be started again.
- If the stored token is missing or expired, the page says the bank sign-in
  expired and nothing was linked.
- No content security policy change was needed: Link loads from the same Plaid
  origins as before.

Owner steps to test it in Sandbox (needs a deployed Preview, since the bank
must be able to send the browser back to a public https address):

1. Add `https://<preview-domain>/oauth/plaid` to Allowed redirect URIs in the
   Dashboard and set `PLAID_REDIRECT_URI` to the same value for Preview.
2. Redeploy, sign in, open My Institutions, press "+ Link an institution" and
   choose Platypus OAuth Bank.
3. Complete Plaid's Sandbox OAuth screen. You should come back to "Linking your
   bank" and then My Institutions, with the institution "Synced".
4. Local only: with `PLAID_REDIRECT_URI=http://localhost:3100/oauth/plaid` and
   `PLAID_ENV=sandbox` the same flow works under `pnpm dev`, provided that
   address is also registered in the Dashboard.

## Switching to Production

Moving to `PLAID_ENV=production` means real accounts and real data. The
project rule is that this is the owner's decision, made by a human, in the
Vercel dashboard only. An AI agent must never do it.

## MCP

Plaid has two MCP servers, with different purposes; see
[06 MCP servers](06-mcp-servers.md).
