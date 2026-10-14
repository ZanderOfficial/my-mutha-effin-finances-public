# 06. MCP servers: let an AI agent help with the install

MCP (Model Context Protocol) is an open standard that lets an AI agent call
tools in another service. With it, an agent such as Claude Code can inspect
your Neon, Vercel and Plaid accounts instead of you copying screens into a
chat. Everything below was checked against the vendors' own documentation on
2026-10-03. Vendors change these quickly, so re-check the linked page if a
command fails.

## Adding a remote server to Claude Code

Syntax from https://code.claude.com/docs/en/mcp:

```bash
claude mcp add --transport http <name> <url>
```

Scopes: `local` (the default, private to you and the current project),
`project` (written to a shared `.mcp.json` in version control) and `user`.
Never use `--scope project` with anything that contains a key.

To sign in with OAuth, start Claude Code and run `/mcp`, then follow the
browser flow. The docs also list `claude mcp login <name>` from the command
line.

## Neon

Docs: https://neon.com/docs/ai/neon-mcp-server and the Claude Code guide at
https://neon.com/guides/claude-code-mcp-neon.

```bash
claude mcp add --transport http neon https://mcp.neon.tech/mcp
```

OAuth is the default. A read-only mode is documented: add `?readonly=true` to
the URL, which limits the agent to SELECT queries and schema inspection.
A project-scoped form is `?projectId=<your-project-id>`. Neon also documents
`npx neon@latest init` as a one-step setup, which installs agent tooling and
links a project; this guide has not run it, so review what it changes first.

What it lets the agent do: create projects and branches, run SQL, change
schemas. Neon's own warning is that it grants broad database management
capabilities, is meant for development and testing, and should not be pointed
at production; always review the actions the model asks for.

For this project: prefer the read-only URL, scope it to your project, and use
it against the development branch only.

## Vercel

Docs: https://vercel.com/docs/agent-resources/vercel-mcp

```bash
claude mcp add --transport http vercel https://mcp.vercel.com
```

Then run `/mcp` inside Claude Code to authenticate. Vercel's page lists Claude
Code as a supported client and says to confirm the endpoint is exactly
`https://mcp.vercel.com`. It lets the agent search Vercel docs, manage
projects and deployments, read deployment logs and query analytics. Vercel warns
that the agent gets the same access as your Vercel user, and recommends human
confirmation on every step.

## Plaid

Docs: https://plaid.com/docs/resources/mcp/. Plaid has two servers.

1. Dashboard MCP, `https://api.dashboard.plaid.com/mcp/` (Streamable HTTP).
   Plaid's page says it authenticates with an OAuth token from your
   `client_id` and secret using the `client_credentials` grant and the
   `mcp:dashboard` scope, the token expires after 15 minutes, and it works
   with Production data only and needs approved Production access. Its tools
   are diagnostic: `plaid_debug_item`, `plaid_get_link_analytics`,
   `plaid_get_usages`, `plaid_list_teams`. Because it needs a Production
   credential and handles live data, this guide does not recommend connecting
   it to an AI agent while you are still setting up.
2. Plaid AI coding toolkit sandbox server (https://github.com/plaid/ai-coding-toolkit/tree/main/sandbox),
   run locally. Its README shows `claude mcp add plaid -- uvx mcp-server-plaid
   --client-id <id> --secret <secret>` with Sandbox credentials only. Tools:
   search docs, get a sandbox access token, simulate a webhook, and a
   mock-data prompt. Caveats: it needs `uv` installed; passing the secret on the
   command line stores it in your local Claude config and can show in process
   lists, so use only the Sandbox secret, and rotate it afterwards if in doubt.
   I could not verify from an official source a way to pass the secret through
   an environment variable instead. Do not use its mock-data tool to put
   financial figures into this repository; the project forbids invented data.

## Actions that always need a human

Keep manual approval on in your agent for each of these:

- creating any cloud resource (Neon project or branch, Vercel project);
- adding, viewing or changing a key, secret or environment variable;
- any write to a database, and any query at all against production;
- switching `PLAID_ENV` to `production` or using a Production secret;
- deploys, domain changes and anything that costs money;
- deleting a branch, project or deployment.

## Agent install prompt

Copy this to your agent after cloning your fork and opening it in Claude Code.

```text
You are helping me install my own copy of MMFF-App. Read setup/README.md and
setup files 01 to 07, AGENTS.md and docs/trapstoknow.md first. Rules:
1. Follow setup/README.md's order. Say what is built today versus planned.
2. Work only against Plaid Sandbox and a Neon development branch.
3. STOP and ask me before you: create any cloud resource, enter or read any
   key or secret, set an environment variable, run any SQL that writes,
   touch production data, deploy, or switch Plaid to production. Wait for a
   clear yes each time.
4. Never print, store or ask me to paste a secret into this chat. I will put
   secrets in apps/app/.env.local and the Vercel dashboard myself. Never
   commit a .env file.
5. Never use real bank data. Use only Plaid's documented sandbox test values.
6. Start with step 01 and run: pnpm lint && pnpm typecheck && pnpm test &&
   pnpm build. Report results, then ask which service to do next.
7. Do not commit or push unless I ask.
```
