---
name: zappi-remote-mcp
description: Connect any MCP client to the Zappi staging HTTP MCP server at https://api-dev.zappi.money/mcp over OAuth. After pairing, offer to add money. A deposit asks currency, then network, then the amount and its minimum, then the address. There is no default pot and no spend mode. Never hold, request, or echo a seed, deviceCode, zpc_, or pot-client token.
---

# Zappi remote MCP

Every MCP client — Grok, Cursor remote, Claude Desktop, Claude Code, VS Code, Codex, or any other — reaches Zappi staging through the same Streamable HTTP endpoint:

```
https://api-dev.zappi.money/mcp
```

The web app that pairs and approves sends is `https://dev.zappi.money`. Production is `https://api.zappi.money/mcp` with `https://zappi.money`. There is no local pot key on the agent host. `create_pot` returns one `pairUrl`. Show that URL, then call `wait_pairing`. When that returns `approved`, the pot is attached. Offer to add money. There is no default pot and no spend mode.

A published client uses the staging URL above. A Nest process on this machine is `http://127.0.0.1:3011/mcp` (not `localhost`: macOS resolves that to `::1`, and Nest listens on IPv4). Leave `ZAPPI_PUBLIC_GATEWAY_URL` empty only for that loopback case. Do not point Cursor at an offline ngrok host.

## Connect

Add that server as a custom MCP server in the host. Staging Cursor's entry is `https://api-dev.zappi.money/mcp`. OAuth 2.1 with PKCE is the login. Discovery lives at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`. Register, authorize, token, revoke, and consent live under `/api/oauth/`. The human approves at `/pair?oauth=…`.

The access token is an opaque `mcp_` string the MCP client stores and sends as `Authorization: Bearer`. It is not a JWT and not a `zpc_`. Leave extra headers empty. Do not paste a seed, a device code, or a pot-client token into the host config.

Connecting does not attach a pot. `whoami` and `list_pots` work after authorize. Tools that touch a pot need a pot on this connection. Omitting `pot` returns `need_choice` when this connection can see a pot. Pass `pot` by name, or `potId`.

Call `read_skill` with one name before creating a pot, depositing, or spending: `zappi-pot`, `zappi-deposit`, or `zappi-spend`. `zappi-mcp` is the index. Do not load every playbook up front.

## Registered tools

The same names are on every connection from the first tools/list, including after a reconnect: `whoami`, `login`, `logout`, `list_skills`, `read_skill`, `list_pots`, `detach_pot`, `start_pairing`, `wait_pairing`, `create_pot`, `issue_address_challenge`, `get_pot_balance`, `wallet_events`, `register_spender_key`, `list_deposit_assets`, `list_deposit_networks`, `deposit_address`, `list_send_assets`, `list_send_networks`, `send`, `wait_spend`.

`list_deposit_rails` is not an MCP tool. Do not call it. Not registered: `health`, `create_approval_ticket`, `bind_pot_address`, `payment_status`, `attach_pot`, `pay`, `consume`. Do not call them.

## Pair a pot

When there is no pot, call `create_pot`. Do not ask for a name. Pass `label` only when the human already named the pot. There is one pot type. Do not ask a spend mode. A legacy `spendMode` argument is ignored. Do not ask to make a pot the default.

The result is one pot-creation link, `pairUrl`, `attachRequestId`, and a `name`. Show that one URL, then call `wait_pairing` with `attachRequestId`. A `pending` result means call it again. Announce `approved`. Do not ask the human to check. Do not stop after the pair URL. Do not replace that URL with a later `list_pots` link.

When `wait_pairing` returns `approved`, say the pot is attached and include `potId`, `name`, and `sparkAddress`. Then, in two lines: without an allowance, every payment from this pot needs their approval; if they want the agent to spend on its own, they can set an allowance on the pot page. Then offer to add money. Read `zappi-deposit` and ask the currency first.

`start_pairing` is for a pot that already exists. Pass `spenderPublicKey` from `zappi-allowance-spender pubkey` on `create_pot` and on `start_pairing`. Do not start the spender. This server does not create the key. `register_spender_key` is only the fallback when that create could not pass the key. `zappi-pot` has the install commands. A host with no shell skips the spender and calls `create_pot` without a key.

## Deposit

A deposit with nothing named asks the currency, then the network, then the amount and its minimum, then the address. Do not show asset and network pairs in one list. Do not hardcode USDC, USDT, or any other asset. Do not skip the amount.

- Nothing named. Call `list_deposit_assets`, or `deposit_address` with no asset. Both return `assets` and do not mint. Ask `message` with one option per `assets` label, copied exactly, in that order. Stop until they pick.
- Currency named. Call `list_deposit_networks` with that asset. Ask which network, one option per `networkName`. One network still states `minDepositCents` and does not mint. Several networks return those networks and do not mint.
- Network named. Ask the amount and state that network's `minDepositCents`. Then call `deposit_address` with `asset`, `network`, and `amountCents`. An amount below that minimum does not mint.
- Lightning invoice. After Bitcoin Lightning is chosen, ask Address or Invoice. An invoice uses `amountSats` instead of `amountCents`.
- `unsupported` means say so and repeat the asset list. Do not guess another asset.
- `status` `ready` means one address. Tell the human the address, the asset, and the network. State that only that asset and network will land in the pot.

Pass `pot` or `potId` on every deposit call. There is no default pot.

## Create

Call `create_pot` with no extra fields first, except `spenderPublicKey` from `pubkey` and `loginRequestId` when this chat is already signed in. Do not ask the spend mode, the name, or a default pot before the tool returns.

- `need_choice` means that name is already taken. The question text is `message`. Each choice label is one option, in order. Call again with `label`, or with `skipName` `true`.
- A connection that has never signed in still gets one `pairUrl`. That page signs them in and authorizes this app. Do not show a separate `loginUrl`.
- Keep `name`. There is no `potId` until `wait_pairing` is `approved`.

## Spend

`send` and `wait_spend` are the spend tools. `list_send_assets` and `list_send_networks` list payout rails. Call those two only when the human asks what they can send to. There is no separate pay or consume tool.

Call `send` once with `amountCents`, `destinationAddress`, and only the asset and chain the human named. Omit `idempotencyKey`. Do not read the deposit lists to choose a payout.

- No signed allowance, key on the human's device: `send` returns `approveUrl` and `requestId`. Give that URL to the human, then call `wait_spend` with `requestId` until it returns. Announce `txid` when status is `sent`. Do not ask the human to check.
- Signed allowance: `send` returns `allowance_pull`.
- Key held by Zappi, no allowance: `send` returns `allowance_required`. Nothing moved and there is no approve link. Tell the human once that an allowance can't be set in the Zappi app for a pot Zappi holds yet, so this send can't go through for now. Do not retry it.

Do not call `send` to fund the pot. A deposit stays on the deposit tools above.

## Hard rules

- Never print, log, or `cat` a seed, `deviceCode`, `zpc_`, the pot-client token, `mcp_`, `ZAPPI_ACCESS_TOKEN`, `ZAPPI_PROJECT_API_KEY`, `ZAPPI_UNLOCK_TOKEN`, `ZAPPI_POT_PASSPHRASE`, `ZAPPI_ATTACH_DEVICE_CODE`, or `ZAPPI_COOKIE`. Tool text and errors pass through `redactSecrets`. Mnemonic-shaped strings are redacted.
- Never accept a seed phrase, a `zpc_` token, or a `zpu_` token as a tool argument. Refuse them.
- Never put a secret in argv or in the host config. The destination and amount are the only spend inputs.
- Never invent a destination. Use the destination the human named, exactly.
- Never invent a chain. Pass `asset` and `destinationChain` only when the human named them. `network` is the account network, not the payout chain.
- Do not fall back to the human's main wallet. An empty pot stops spending.
- URLs on tools must be `https`, or `http` only for loopback. `javascript:`, `file:`, `data:`, and credentialed URLs are refused.
- `SPARK_NETWORK` must be unset or `MAINNET`. Spark destinations must be mainnet prefixes (`spark1`, `sp1`).
- Argument values must not start with `-` and must not contain `\r\n\0`. That blocks flag injection.
- On a tool error, report the redacted message and stop. Do not read `~/.zappi` and do not work around the tool with `curl` or a script.

## Host-specific notes

- **Grok Bot** is not an MCP Apps host. Tool results are text content only. There is no `ui://` UI. Copy a pair link in full and do not shorten the URL.
- **Cursor remote** and other MCP Apps hosts may render `ui://` resources when the server offers them. The flow above does not change.
- **Staging** uses `https://api-dev.zappi.money/mcp`. A Nest process on this machine uses `http://127.0.0.1:3011/mcp` in `~/.cursor/mcp.json` and authorizes at the local `/pair?oauth=…` page. Production is `https://api.zappi.money/mcp`.
