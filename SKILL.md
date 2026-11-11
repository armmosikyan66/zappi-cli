---
name: zappi-cli
description: Index of Zappi CLI playbooks for creating a pot, sign-in, a deposit, or a spend. A person or an agent runs zappi-cli. Read only the one skill that job needs.
---

# Zappi CLI

The CLI is a terminal for a person or an agent. It creates a pot, deposits, and sends. It does not speak MCP. A chat can still use the MCP server. This login is `zappi-cli login`, or `zappi-cli guest` for a free pot without an account.

A Spark address is `sparkAddress` on `zappi-cli pots`. A balance is `zappi-cli pots balance`. Run that command and answer. Do not open a skill or search the repo for those reads.

Read one playbook before creating a pot, depositing, or spending. Do not load every playbook up front.

| Skill | When |
| --- | --- |
| zappi-cli-account | `login`, `whoami`, `logout`, `guest`, `guest claim` |
| zappi-cli-pot | create, list, connect, disconnect, pair, balance |
| zappi-cli-deposit | `deposit assets`, `deposit networks`, `deposit address` |
| zappi-cli-spend | `pots send`, catalog, approve URL, `txid` |

## Install

```bash
npm install -g @zappimoney/zappi-cli
zappi-cli login
```

`--json` prints the body. `need_choice` and a refusal exit 0. Exit 1 is a transport failure, an unknown flag, or a missing login when the command needs an account. The CLI mints an idempotency key when one is omitted and includes it in the JSON. It does not print a session or a guest secret.

## Commands

| Command | What it does |
| --- | --- |
| `zappi-cli whoami` | Account email, or guest mode |
| `zappi-cli login` / `zappi-cli logout` | Save or revoke this login |
| `zappi-cli guest` | Start a free pot without an account |
| `zappi-cli guest claim --pot <id>` | Move that pot onto the account |
| `zappi-cli pots` | List pots on this login |
| `zappi-cli pots create [--spend-mode free\|auth_required] [--label] [--skip-name] [--auth-choice skip] [--limits default\|custom] [--per-payment <dollars>] [--per-day <dollars>]` | Create a pot |
| `zappi-cli pots connect --pot <name-or-id> [--default]` | Connect a free pot to this login |
| `zappi-cli pots disconnect --pot <name-or-id>` | Remove it from this login |
| `zappi-cli pots pair [--pot <id>]` | Approve URL for an auth-required pot |
| `zappi-cli pots balance [--pot <id>]` | Balance |
| `zappi-cli pots challenge --address <spark>` | Address challenge |
| `zappi-cli deposit assets [--pot <id>]` | Currencies. This is the deposit question |
| `zappi-cli deposit rails [--pot <id>]` | Same currency list as `deposit assets`. Not the deposit question |
| `zappi-cli deposit networks [--asset] [--pot <id>]` | Networks |
| `zappi-cli deposit address [--asset] [--network] [--amount-cents] [--amount-sats] [--pot <id>]` | Deposit address |
| `zappi-cli pots send assets [--pot <id>]` | Payout assets |
| `zappi-cli pots send networks [--asset] [--pot <id>]` | Payout networks |
| `zappi-cli pots send --amount-cents <n> --to <address> [--asset] [--chain] [--memo] [--pot] [--idempotency-key]` | Send |

`pots connect` is not `pots attach`. `pots attach` is the device-code pairing command. `pots send` is not `zappi-cli send`. `zappi-cli send` is the wallet send. `deposit rails` is not the deposit question. It is not `deposit-options` or `deposit-address`. A deposit with nothing named is `deposit assets`, then `deposit networks --asset`, then `deposit address --asset --network` with no `--amount-cents`. Show the address or Lightning Address on its own line. State the network minimum. Say they can send any amount at or above that minimum. Ask for an amount only for a Lightning invoice, then pass `--amount-sats`.

`zappi-cli pots` with no subcommand lists this login. A project API key, or `--origin` / `--spend-mode`, keeps the wallet list.

A free pot is sealed by the server. `zappi-cli pots send` on that pot is signed by the server and returns `settled` with `txid`. An auth-required pot returns one approve URL. Give that URL to the person and stop.
