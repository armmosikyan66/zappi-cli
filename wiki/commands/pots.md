---
type: command
tags: [cli, pots]
updated: 2026-09-22
---

# pots

Agent-pot owner routes. Same [[reference/auth]] as [[commands/wallet]]. Flags-only (`pots --json`) means `list`. Usages: [[usages]].

```text
zappi-cli pots <list|register|deposit-address|grants|spend-gate|spend-approvals|attach|attach-status>
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
zappi-cli pots attach [--spend-mode free|auth_required] [--spark-address <addr>] [--label <name>] [--no-poll]
zappi-cli pots attach-status <requestId>
```

Device-code pairing (P1). `createPotAttach` returns `requestId`, `userCode`, and `approveUrl`.

- Pretty mode without `--no-poll`: opens the approve URL (headline “Approve this pot in Zappi”), then polls every 2 seconds until status is not `pending` or 15 minutes elapse.
- `--no-poll`: prints request id, user code, approve URL, and `Poll with: zappi-cli pots attach-status <requestId>`. Does not open the browser.
- `--json` does not open the browser. It still polls unless `--no-poll` is set.

Terminal poll fields: `status`, `potId`, `grantId`. Pretty output shows the client token as `zpc_… (withheld)` and says to store it as a host secret. `--json` includes `potClientToken` when nest returns it — treat that stdout as a secret. `attach-status` is one poll, not a loop.
