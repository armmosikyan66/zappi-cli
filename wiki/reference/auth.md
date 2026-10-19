---
type: reference
tags: [cli, auth]
updated: 2026-10-07
---

# Auth

Three doors into Zappi. The local stdio MCP signer (`@zappimoney/zappi-mcp`) and its OS keychain seed store (`money.zappi.mcp`, `seed:<potId>`) are gone — there is no agent door that holds a pot seed. Agents spend through approval tickets on the remote `/mcp`; a human signs in the web app.

Three credentials, never mixed: the account login (JWT), the pot-client token `zpc_`, and the pot seed. The seed is **not** an API key. It only ever lives in the human CLI files or the web app session — never on an agent host.

| Door | Who | Credentials on the host | Spend path |
| --- | --- | --- | --- |
| 1. CLI by hand | Human at a terminal | `~/.zappi/credentials.json` (login JWT), `ZAPPI_ACCESS_TOKEN`, `ZAPPI_PROJECT_API_KEY`; pot seed in `ZAPPI_POT_SEED` or `~/.zappi/pot-*.txt`; `zpc_` in `ZAPPI_POT_CLIENT_TOKEN` or `~/.zappi/pot-client-*.txt` | `zappi-cli pay` / `consume` / `request` signs locally with the seed |
| 2. Shell skill | Agent shelling out to the same CLI | Reuses door 1's files verbatim — no separate credential store | Setup/attach only (`propose`, `pots attach`, `pots bind`); spend on the agent host is door 3 |
| 3. Remote `/mcp` | Any MCP client (Cursor, Grok, remote hosts) | One opaque OAuth `mcp_` Bearer token, stored by the MCP client | `create_pot` seals a free pot in Nest and returns `sparkAddress`. `pay` / `send` / `consume` on that pot return `settled` and `txid`. An auth-required pot returns one approve URL; the human signs in the web app. No seed on the agent. |

## Door 1 — CLI by hand

Package: [packages/zappi-cli](../..). Files under `~/.zappi/` are mode `0600`. Override the credentials path with `ZAPPI_CREDENTIALS_FILE`.

**Account auth.** `zappi-cli login` runs the device-code flow: `POST /api/auth/cli/device`, browser sign-in, poll `POST /api/auth/cli/token`. Access and refresh JWTs land in `~/.zappi/credentials.json`. Env `ZAPPI_ACCESS_TOKEN` wins over the file. `ZAPPI_PROJECT_API_KEY` is env-only.

**How requests go out** ([src/client.ts](../../src/client.ts)):

- Project key → `Authorization: Bearer <key>`.
- User session → `x-zappi-access-token: <jwt>` (plus optional `x-zappi-cookie`, `x-zappi-user-agent`).
- Pot-scoped call → `x-zappi-pot-client: <zpc_>`.

Precedence in the client: `ZAPPI_PROJECT_API_KEY` → `{ kind: 'projectKey' }`; else `ZAPPI_ACCESS_TOKEN` → `{ kind: 'session' }`; else throw (set a project key or an access token — the seed is not a client credential).

**Pot spend key** ([src/load-pot-seed.ts](../../src/load-pot-seed.ts)), used only to sign Spark USDB (`pay`, `withdraw confirm`, `send internal/external`):

1. `ZAPPI_POT_SEED` if set (reject `<…>` placeholders).
2. Else `ZAPPI_POT_KEY_FILE` — the phrase is the last non-blank, non-`#`, non-`key: value` line with 12–24 words.
3. Else `~/.zappi/pot-*.txt` (same line rule).
4. Else throw. Do not paste the key into chat.

Account number for CLI signs is `0`. Network is `SPARK_NETWORK` (unset = MAINNET; any other value is rejected).

**Pot-client token (`zpc_`).** Required for an auth-required pot. `ZAPPI_POT_CLIENT_TOKEN` wins; else `~/.zappi/pot-client-*.txt`. The CLI reclaims it after pairing. Never echo it, never ask a human to paste it.

**Unlock bearer.** Only [[commands/consume]] (and `pay`'s internal auto-consume, which uses the token Nest just returned and does not print it). Env wins over `--unlock-token`.

**Step-up token.** `--auth <token>` on `withdraw confirm`, `send internal`, `send external`, and `pots spend-approvals --approve` is an authorization token passed to Nest. It is not the pot seed and not the unlock bearer. `pay` and `invite` use neither the project key nor the access token; invite sends no session.

## Door 2 — Shell skill reusing the CLI files

The skill ([SKILL.md](../../SKILL.md)) is instructions, not a connection. The agent runs `zappi-cli` in a shell; the CLI reads the exact same files and env as door 1 — there is no second credential store. The skill is for setup and attach (`propose`, `pots attach`, `pots bind`, pairing URL). It forbids asking the user to paste `zpc_` or the seed. `zappi-cli login` is human-only — an agent host does not run it.

Spending on an agent host is **not** a CLI command in the skill. It is door 3: an approval ticket through the remote `/mcp`. The CLI spend commands (`pay`, `consume`, `request`) remain available to a human at the terminal (door 1), where the seed file and `zpc_` live on the same machine.

## Door 3 — Remote `/mcp` (the only agent spend door)

Endpoint: `https://api.zappi.money/mcp` (Streamable HTTP). Already live on the Nest API at `GET/POST /mcp` ([server/src/mcp/mcp.constants.ts](../../../../server/src/mcp/mcp.constants.ts)).

**Auth.** OAuth 2.1 with PKCE. Discovery at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`; register, authorize, token, revoke, and consent live under `/api/oauth/`. The human approves at `/pair?oauth=…`. The access token is an **opaque `mcp_` string** stored by the MCP client and sent as `Authorization: Bearer mcp_…`. It is not a JWT and not a `zpc_`.

**No seed on the agent.** The agent never holds or sends a pot seed and never pastes `zpc_`. A free pot is sealed by Nest: `create_pot` returns `sparkAddress`, and `pay`, `send`, and `consume` return `settled` with `txid`. An auth-required pot returns one approve URL; the human opens it in the Zappi web app and the human session signs. Read and pairing tools (`list_pots`, `start_pairing`, `list_deposit_rails`, `deposit_address`) need only the `mcp_` Bearer token.

## What is removed

- The OS keychain seed store (`money.zappi.mcp`, `seed:<potId>`) — that local signer is gone. There is no keychain row in the table above and no agent credential backed by the OS keychain.
- The local stdio MCP server (`@zappimoney/zappi-mcp`) and the `zappi-cli mcp` stdio subcommand. Agents use door 3.
