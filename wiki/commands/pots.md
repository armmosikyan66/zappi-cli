---
type: command
tags: [cli, pots]
updated: 2026-10-08
---

# pots

Agent-pot owner routes. Same [[reference/auth]] as [[commands/wallet]]. Flags-only (`pots --json`) means `list`. Usages: [[usages]].

```text
zappi-cli pots <list|register|deposit-address|grants|spend-gate|spend-approvals|attach|attach-status|bind>
```

## list

```bash
zappi-cli pots [--origin user|agent|unknown] [--spend-mode free|auth_required|unknown]
zappi-cli pots list [--origin …] [--spend-mode …]
```

Empty: `No pots.` Each row: label (or id), spark address, spend mode, status. Plain text also prints `connected=`.

## register

```bash
zappi-cli pots register <sparkAddress> [--label <name>] [--spend-mode free|auth_required]
```

`createPot` with the public spark address. This is the API register, not the [[commands/propose]] deep link. Duplicate labels: nest `409 AGENT_POT_LABEL_EXISTS` (from [[sources/readme]]).

## deposit-address

```bash
zappi-cli pots deposit-address <id> [--source-chain <chain>]
```

Creates an Orchestra deposit address that credits the pot. `--source-chain` is sent as `sourceChain` (help example: `base`). Prints pot id and deposit address.

## grants

```bash
zappi-cli pots grants <id>
zappi-cli pots grants <id> --create [--scopes read,deposit]
zappi-cli pots grants <id> --revoke <grantId>
```

List is the default. `--create` splits `--scopes` on commas; omitted scopes become `['read']`. `--revoke` calls revoke and warns: disconnect cannot stop on-chain spend; empty pot is the cap.

## spend-gate

```bash
zappi-cli pots spend-gate <id> [--action withdraw|internal_send|sweep]
```

Prints pot id, spend mode, `gated`, and `leash`.

## spend-approvals

```bash
zappi-cli pots spend-approvals <id>
zappi-cli pots spend-approvals <id> --create --action withdraw|internal_send|sweep [--amount <cents>] [--destination <addr>]
zappi-cli pots spend-approvals <id> --approve <approvalId> [--auth <token>]
zappi-cli pots spend-approvals <id> --reject <approvalId>
```

`--create` without `--action` throws. `--amount` is cents. `--approve` forwards `--auth` as the authorization token. `--reject` does not take `--auth`.

## attach / attach-status

```bash
zappi-cli pots attach [--pot <potId>] [--spend-mode free|auth_required] [--spark-address <addr>] [--label <name>] [--no-poll]
zappi-cli pots attach-status <requestId>
```

Device-code pairing (P1). `createPotAttach` returns `requestId` and `approveUrl`. The printed URL includes `pot=` and omits `code=`.

**The pairing names the pot (1-554).** Auth-required pairing:

```bash
zappi-cli pots attach --pot <potId> --spend-mode auth_required
```

- The pot comes from `--pot <potId>` or `ZAPPI_POT_ID`. Auth-required with neither fails before any Nest call. Both set and different → `Conflicting pot selectors: --pot … but ZAPPI_POT_ID=…`. A bare `--pot` or a value that is not a pot id (UUID or ≥ 8-hex prefix) fails without echoing the value.
- The pot id is always sent to Nest as `potId` on `POST /api/wallet/pots/attach`. Nest stores it as `requestedPotId` and returns 400 `AGENT_POT_ATTACH_POT_REQUIRED` for auth-required without it.
- Nest must echo the same pot (approve link `pot=`, or a `requestedPotId` / `potId` body field). Otherwise no link is printed and no device code is stored.
- Polling fails closed if the pending request names another pot or the approval bound another pot (prefix rule as Nest: full id, or the id starting with an ≥ 8-char prefix). Reclaim fails closed if the credentials name another pot. In both cases the `zpc_` is not stored.
- `/pair` names the pot by matching `requestedPotId` (or link `pot=`) against the signed-in user's active pots; Nest approve rejects any other pot (`AGENT_POT_ATTACH_POT_REQUIRED`) and a spend-mode change (`AGENT_POT_ATTACH_MODE_MISMATCH`).
- The web "Pair this host" row should copy this command for the installed, pinned `zappi-cli` — never `npx` (1-555). Until pairing is approved, an auth-required pot cannot `request`, `pay`, `consume`, or `invite` from the bot. Paste the pairing URL only — never the user code, never a `zpc_` paste.

- Pretty mode without `--no-poll`: opens the approve URL (headline “Approve this pot in Zappi”), then polls every 2 seconds until status is not `pending` or 15 minutes elapse.
- `--no-poll`: prints request id and approve URL (no user code), and `Poll with: zappi-cli pots attach-status <requestId>`. Does not open the browser.
- `--json` does not open the browser. It still polls unless `--no-poll` is set.

Terminal poll fields: `status`, `potId`, `grantId`. Pretty output shows the client token as `zpc_… (withheld)` and says to store it as a host secret. `--json` includes `potClientToken` when nest returns it — treat that stdout as a secret. `attach-status` is one poll, not a loop.

## bind

```bash
zappi-cli pots bind <potId> [--label <name>] [--key-file <path>] [--no-poll]
```

Pot-first free pot. The app created an addressless `pending` free pot (no `sparkAddress`); this command binds a bot-generated key onto it through the device-code attach flow. Nest never holds the mnemonic.

1. Calls the public `GET /wallet/pots/attach/preview?potId=` and **fails closed** if the pot is missing, not `free`, or not `pending`.
2. Generates a BIP-39 mnemonic + derives the public `sparkAddress` on this host; writes a `0600` key file (`~/.zappi/pot-*.txt` by default, or `--key-file`). The mnemonic is a **host secret** — never printed, never logged.
3. `createPotAttach({ potId, sparkAddress, spendMode: 'free' })` (device-code P1); stores `deviceCode` via the attach-device-secret helper.
4. Prints **one pairing URL only** — never the mnemonic, never the user code, never `zpc_`. Pretty mode opens the browser and polls every 2s (15m cap); `--no-poll` prints request id + approve URL.
5. On `approved`, reclaims `potClientToken` (`zpc_`) itself and stores it as a host secret. Then set `ZAPPI_POT_ID` and `ZAPPI_POT_SEED` (or `ZAPPI_POT_KEY_FILE`) and use the pot as a normal free pot (`pay` / `consume`).

Refuses if this host already holds a pot client token (`ZAPPI_POT_CLIENT_TOKEN` / `~/.zappi/pot-client-*.txt`) — set `ZAPPI_POT_ID` and use the existing pot instead. `--json` includes `sparkAddress`, `keyFile`, `status`, `potId`, `grantId`, and `potClientTokenReceived` (never the mnemonic or `zpc_`).
