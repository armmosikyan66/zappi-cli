---
name: zappi-remote-mcp
description: Connect any MCP client to the Zappi staging HTTP MCP server at https://api-dev.zappi.money/mcp over OAuth. Read pots, pair a pot, and deposit via list_deposit_rails + deposit_address. Spend is approval tickets only — call create_approval_ticket, give the user the approve URL, and stop. Never hold, request, or echo a seed, deviceCode, zpc_, or pot-client token.
---

# Zappi remote MCP (the only agent door)

Every MCP client — Grok, Cursor remote, Claude Desktop, Claude Code, VS Code, Codex, or any other — reaches Zappi staging through the same Streamable HTTP endpoint:

```
https://api-dev.zappi.money/mcp
```

The web app that pairs and approves spends is `https://dev.zappi.money`. Production is `https://api.zappi.money/mcp` with `https://zappi.money`. Do not run a local stdio signer. There is no local pot key on the agent host. The agent never signs a spend. Spending is an approval ticket that a human approves in the Zappi web app, where the human's session signs.

A published client uses the staging URL above. A Nest process on this machine is `http://127.0.0.1:3011/mcp` (not `localhost`: macOS resolves that to `::1`, and Nest listens on IPv4). Leave `ZAPPI_PUBLIC_GATEWAY_URL` empty only for that loopback case. Do not point Cursor at an offline ngrok host.

## Connect

Add that server as a custom MCP server in the host. Staging Cursor's entry is `https://api-dev.zappi.money/mcp`. OAuth 2.1 with PKCE is the login. Discovery lives at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`. Register, authorize, token, revoke, and consent live under `/api/oauth/`. The human approves at `/pair?oauth=…`.

The access token is an opaque `mcp_` string the MCP client stores and sends as `Authorization: Bearer`. It is not a JWT and not a `zpc_`. Leave extra headers empty. Do not paste a seed, a device code, or a pot-client token into the host config.

Connecting does not attach a pot. `whoami`, `list_pots`, and `health` work after authorize. Tools that touch a pot need a pot attached.

## Pair a pot

If no pot is attached, call `start_pairing`. It returns a `pairUrl`. Give that URL to the user and stop. They approve a pot on that page in the Zappi web app. The same connection then uses that pot. Do not ask them to paste a seed, a device code, or a token. Do not call spend tools until a pot is attached and the user asks to spend.

## Read tools (already live)

- `whoami` — the signed-in account. No arguments. Returns username, email, account id, and network. Username is the first line of the text. A missing username or email is omitted from the structured result and shown as `none` in the text. Call this to identify the account. Do not name another account.
- `health` — readonly, booleans only.
- `list_pots` — pots for the signed-in account. For each unattached pot, copy the tool text line `[Attach <name>](<full attachUrl>)` exactly. Do not ellipsize the URL. Do not use the pot UUID as the label.
- `list_deposit_rails` — asset and network options for deposit.
- `deposit_address` — one deposit address for a chosen asset + network.

## Deposit

A deposit, fund, or receive is one tool for the case in front of you, then stop. The asset menu is the `list_deposit_rails` result. Do not hardcode USDC, USDT, or any other asset.

- No asset named. Call `list_deposit_rails` with no arguments. Show only those rows, grouped by asset. Stop.
- An asset is named and you do not yet have that asset's rows. Call `list_deposit_rails` only. Route on that result before any address call.
- The named asset has one network in the tool result, or the user has picked one network from that asset's rows. Call `deposit_address` with that asset and, when they picked one, that network.
- The named asset has several networks and they have not picked one. Ask which network. Use only that asset's rows. Stop. Call `deposit_address` only after they pick.
- The asset is not in the list (`status` is `unsupported`). Say it is unsupported and repeat the list. Do not guess another asset.
- `deposit_address` with a missing asset, or with several matching networks, returns `need_choice` and does not mint. Show those choices and stop.
- `status` `ready` means one address. Tell the user the address, the asset, and the network (`networkId`). Then stop.

## Spend — approval tickets only

`pay`, `send`, and `consume` do not sign on the agent host. They create an approval ticket and return one approve URL. The agent gives the user that URL and stops. The user opens it in the Zappi web app, approves, and the web app signs with the user's session. The agent never receives a seed, never signs, and never pastes `zpc_`.

Flow:

1. The user names an amount and a destination (or resource). If either is missing, ask for that one thing and stop.
2. Call `create_approval_ticket` with the amount and destination the user named.
3. Read the `approveUrl` from the result. Give that URL to the user. Tell them to open it in the Zappi web app to approve.
4. Stop. Do not retry in a loop. Do not call the spend tool again. Do not poll for approval status from here — the user will tell you when it is done, or you can call `balance` / `transactions` after they confirm.

If `create_approval_ticket` says the ticket rate cap is reached, stop. Do not retry in a loop. Tell the user the cap was hit and wait.

Do not call `pay`, `send`, or `consume` to fund the pot. A deposit, fund, or receive stays on the deposit tools above.

## Auth-required ticket contract

`zappi-cli request` and remote `/mcp` `pay`, `send`, and `consume` create one Nest spend ticket. The browser signs. Nest stores no seed.

`POST /api/wallet/pots/:potId/spend-requests` returns **201**. The body is the ticket: `id`, `potId`, `approveUrl`, `amountCents`, `destinationAddress`, `destinationChain`, `memo`, `status`, `sparkTxHash` (null until a receipt lands), `expiresAt`, `decidedAt`, `createdAt`. An attached pot's response has no `potClientToken`. `approveUrl` is `https://<app>/?panel=pots&spend=<id>` with no `code=` and no `zpc_`. If a response puts `code=` on that URL, the CLI strips it. If `zpc_` remains on the URL, the CLI refuses to print it.

Opening the link sends no funds. The web app redirects `/?panel=pots&spend=` to `/pair?spend=`. Approve and deny only record the decision. The browser that holds the pot key broadcasts, then posts `sparkTxHash` on `…/receipt`.

Partly-works edge: Nest accepts the first receipt only when the body includes that broadcast's `claimToken` and `sparkTxHash`. The web client posts `sparkTxHash` alone, so a Spark send can succeed and still leave the ticket without a hash (Nest 409). The agent still stops after the approve URL. Receipt and retry stay with the browser.

Remote `/mcp` rebuilds the link instead of copying Nest's `approveUrl`. `pay`, `send`, and `consume` return `{ approveUrl, tool }` with `approveUrl` set to `https://<app>/pair?spend=<id>`. Same rule: bare URL, no `code=`, no `zpc_`. The tool does not sign.

## Hard rules

- Never print, log, or `cat` a seed, `deviceCode`, `zpc_`, the pot-client token, `mcp_`, `ZAPPI_ACCESS_TOKEN`, `ZAPPI_PROJECT_API_KEY`, `ZAPPI_UNLOCK_TOKEN`, `ZAPPI_POT_PASSPHRASE`, `ZAPPI_ATTACH_DEVICE_CODE`, or `ZAPPI_COOKIE`. Tool text and errors pass through `redactSecrets`. Mnemonic-shaped strings are redacted.
- Never accept a seed phrase, a `zpc_` token, or a `zpu_` token as a tool argument. Refuse them.
- Never put a secret in argv or in the host config. The destination and amount are the only spend inputs.
- Never invent a destination. Use the destination the user named, exactly.
- Never invent a chain. `pay` only settles spark/USDB from the 402 challenge.
- Amounts above the cap are not signed by the agent. They become an approval ticket. Paste that URL and stop.
- Do not fall back to the human's main wallet. An empty pot stops spending.
- URLs on tools must be `https`, or `http` only for loopback. `javascript:`, `file:`, `data:`, and credentialed URLs are refused.
- `SPARK_NETWORK` must be unset or `MAINNET`. Spark destinations must be mainnet prefixes (`spark1`, `sp1`).
- Argument values must not start with `-` and must not contain `\r\n\0`. That blocks flag injection.
- On a tool error, report the redacted message and stop. Do not read `~/.zappi` and do not work around the tool with `curl` or a script.

## Host-specific notes

- **Grok Bot** is not an MCP Apps host. Tool results are text content only. There is no `ui://` UI. `list_pots` text includes one `[Attach <name>](<full URL>)` line per unattached pot; copy that line in full and do not shorten the URL. Other tool text is JSON.
- **Cursor remote** and other MCP Apps hosts may render `ui://` resources when the server offers them. The flow above does not change.
- **Staging** uses `https://api-dev.zappi.money/mcp`. A Nest process on this machine uses `http://127.0.0.1:3011/mcp` in `~/.cursor/mcp.json` and authorizes at the local `/pair?oauth=…` page. Production is `https://api.zappi.money/mcp`.
