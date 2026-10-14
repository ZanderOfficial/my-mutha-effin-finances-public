# Security policy

MMFF-App handles a view of someone's finances, so a vulnerability here can mean
exposed bank data. Please report problems privately and give us a chance to fix
them before they are public.

## How to report a vulnerability

Use GitHub's private security advisories: open the repository's **Security**
tab and choose **Report a vulnerability**. That creates a private thread
between you and the maintainers. Please do not open a public issue or pull
request for a security problem, and do not post details anywhere else.

If the Security tab does not show that button, private reporting has not been
switched on yet. Open a public issue that says only "I have a security report,
please enable private reporting" and nothing else, and we will respond there.

## What to put in a report, and what to leave out

Helpful: what you found, where (file, route or setting), the steps to
reproduce it, and what an attacker could do with it.

**Never include real financial data.** No access tokens, public tokens,
`PLAID_SECRET`, `DATABASE_URL`, encryption keys, bank account or card numbers,
account masks, balances, transactions, webhook bodies or screenshots of a
linked account. If proving the bug seems to need real data, describe the steps
and we will reproduce it with Plaid Sandbox and synthetic values. If you find
a live secret in the repository or its history, say where it is without pasting
it; it will be rotated.

## What is in scope

- Anything that lets someone other than the owner read or change data,
  including a way around row-level security or the owner check.
- Leaking a Plaid token, secret, connection string or other credential through
  a log, error response, URL or page.
- A way to forge or replay a Plaid webhook, or to call the cron route without
  `CRON_SECRET`.
- Weaknesses in token encryption, the content security policy or other
  security headers.

Out of scope: findings that need the owner's own credentials or an already
compromised machine, denial of service by volume, and issues in Plaid, Neon,
Vercel or Next.js themselves (report those to the vendor).

## What to expect

This is a personal project run by one owner, so there is no formal service
level.

## Running your own copy

Each person runs their own deployment and owns their own keys and data; the
maintainers do not host anyone's data and cannot rotate your secrets. If you
are an operator, `docs/LAUNCH.md` covers key rotation and recovery, and
`setup/05-secrets-and-security.md` covers what must never be stored.
