---
type: reference
tags: [cli, usage]
updated: 2026-09-22
---

# Usages

Every `zappi-cli` invocation. Behavior lives on the linked command pages. `--json` may appear on any command (stripped before dispatch). `--help` / `-h` with no command, or as the command, prints help.

```bash
zappi-cli --help
zappi-cli -h
```

## Host setup — [[commands/propose]]

```bash
zappi-cli propose
zappi-cli propose --address <pot-address> [--label <name>] [--mode free|auth_required] [--open] [--origin <url>]
zappi-cli propose --generate [--label <name>] [--mode free|auth_required] [--key-file <path>] [--open] [--origin <url>]
```

Bare `propose` on a TTY runs the wizard. No TTY falls back to this usage text. `--mode` must be `free` or `auth_required`.

## Agent spend

```bash
zappi-cli pay <resourceIdOrUrl> [--no-consume] [--units N] [--json]
zappi-cli consume <resourceIdOrUrl> [--units N] [--unlock-token <token>] [--json]
zappi-cli invite [--json]
```

| Command | Required env | Notes |
| --- | --- | --- |
| [[commands/pay]] | `ZAPPI_POT_ID` plus `ZAPPI_POT_SEED` or `ZAPPI_POT_KEY_FILE` | `ZAPPI_POT_SPEND_MODE=auth_required` refuses. Resource may be an id or `…/api/paywall/resources/:id`. |
| [[commands/consume]] | `ZAPPI_UNLOCK_TOKEN` (env wins over `--unlock-token`) | `--units` default `1`, positive integer. |
| [[commands/invite]] | `ZAPPI_POT_ID` (UUID) | Extra args fail. Do not pass an invite code. |

## Wallet — [[commands/wallet]]

Needs [[reference/auth]] (`ZAPPI_PROJECT_API_KEY` or `ZAPPI_ACCESS_TOKEN`). Amounts below are **cents** (positive integers) unless noted.

```bash
zappi-cli balance [--pot <id>]
zappi-cli transactions [<id>]
zappi-cli deposit-options
zappi-cli deposit-address --asset <asset> --network <network>
zappi-cli withdraw-options
zappi-cli withdraw estimate --asset <a> --network <n> (--address <addr> | --bolt11 <invoice>) [--amount <cents>] [--sats <n>]
zappi-cli withdraw quote    --asset <a> --network <n> (--address <addr> | --bolt11 <invoice>) [--amount <cents>] [--sats <n>]
zappi-cli withdraw confirm <quoteId> [--auth <token>]
zappi-cli withdraw status <id>
zappi-cli send internal --to <userId> --amount <cents> [--memo <text>] [--auth <token>]
zappi-cli send external --asset <a> --network <n> --address <addr> --amount <cents> [--auth <token>]
```

`balance` with `--pot`, or with `ZAPPI_POT_ID` set and no `--pot`, reads the **pot** balance. Otherwise it reads the wallet balance.

`withdraw confirm` and both `send` forms sign Spark USDB from the host pot seed.

## Pots — [[commands/pots]]

Same auth as wallet. `pots` with only flags (for example `pots --json`) means `list`.

```bash
zappi-cli pots [--origin user|agent|unknown] [--spend-mode free|auth_required|unknown]
zappi-cli pots list [--origin user|agent|unknown] [--spend-mode free|auth_required|unknown]
zappi-cli pots register <sparkAddress> [--label <name>] [--spend-mode free|auth_required]
zappi-cli pots deposit-address <id> [--source-chain <chain>]
zappi-cli pots grants <id>
zappi-cli pots grants <id> --create [--scopes read,deposit]
zappi-cli pots grants <id> --revoke <grantId>
zappi-cli pots spend-gate <id> [--action withdraw|internal_send|sweep]
zappi-cli pots spend-approvals <id>
zappi-cli pots spend-approvals <id> --create --action withdraw|internal_send|sweep [--amount <cents>] [--destination <addr>]
zappi-cli pots spend-approvals <id> --approve <approvalId> [--auth <token>]
zappi-cli pots spend-approvals <id> --reject <approvalId>
zappi-cli pots attach [--spend-mode free|auth_required] [--spark-address <addr>] [--label <name>] [--no-poll]
zappi-cli pots attach-status <requestId>
```

`--create` on grants defaults scopes to `read` when `--scopes` is omitted. `--create` on spend-approvals requires `--action`.

## Examples from `--help`

```bash
zappi-cli propose
zappi-cli propose --generate --label Research --open
zappi-cli pay <resourceId>
zappi-cli pay <resourceId> --no-consume
zappi-cli consume <resourceId> --units 1
zappi-cli invite --json
zappi-cli pay <resourceId> --json
zappi-cli balance --json
zappi-cli pots --spend-mode free
zappi-cli withdraw estimate --asset USDC --network solana --address 0x... --amount 100
zappi-cli send internal --to <userId> --amount 100
```

Unknown command, or a bad `withdraw` / `send` / `pots` subcommand, prints usage plus help and exits 1. Stderr errors are passed through secret redaction ([[reference/hard-rules]]).
