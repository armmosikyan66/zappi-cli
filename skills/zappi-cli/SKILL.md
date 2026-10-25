---
name: zappi-cli
description: Explain what zappi-cli is, how its command families work, and the usage for each command. Use when running zappi-cli, when asked how the CLI works, or when a pot, deposit, send, pairing, or local signer needs a command. Read one door playbook before creating a pot, depositing, or spending on this login.
---

# Zappi CLI

`zappi-cli` is the terminal for a Zappi pot. A person or an agent runs it. It does not speak MCP. A chat can still use the remote MCP server. Both use the same pot. The package is `@zappimoney/zappi-cli`. It needs Node.js 20.9 or newer.

The combined pot skill, covering this CLI and the remote MCP server, is hosted at `<app origin>/pots/SKILL.md` (`https://zappi.money/pots/SKILL.md`, staging `https://dev.zappi.money/pots/SKILL.md`). An agent that has not installed either door should fetch that file and install one door. This file stays the CLI reference.

`zappi-cli --help` prints the usage from this binary. The lines below match that dispatch. Longer notes are `README.md` in this package, `wiki/usages.md`, and `docs/developers/cli.mdx`.

## How a command is chosen

One binary. The job picks one family. A payment stays in the family that started it.

**This login.** `zappi-cli login` saves a session in `~/.zappi/credentials.json` (mode `0600`). `zappi-cli guest` starts a free pot without an account and writes `~/.zappi/agent.json` (mode `0600`). The guest secret is not printed. `ZAPPI_ACCESS_TOKEN` wins over the login file. These commands call `/api/cli/*`. The server holds the pot. There is no spend mode and no per-pot limit on this path. The signed Spark allowance is the only cap. A Spark address is `sparkAddress` on `zappi-cli pots`. A balance is `zappi-cli pots balance`. Run that command and answer.

Read one playbook before creating a pot, depositing, or spending on this login.

**Host key.** `propose` writes a pot key on this machine and opens a register link. The human registers and funds in Zappi. The command does not print the key. `request` spends an auth-required pot and prints one approve URL. `invite` prints a Nest invite URL.

**Local signer.** `sign` and the other signer commands spawn `zappi-signer` and forward the terminal. They do not ask for a mnemonic. `pots send` does not use them.

**Wallet.** `balance`, `transactions`, `deposit-options`, `deposit-address`, `withdraw`, and `send` need `ZAPPI_PROJECT_API_KEY` or `ZAPPI_ACCESS_TOKEN`. `send` can sign Spark USDB from the host pot seed.

`zappi-cli pots` with no subcommand lists this login. A project API key, or `--origin` / `--spend-mode`, keeps the wallet pot list (`list`, `register`, `grants`, `attach`, and the rest).

## Install

```bash
npm install -g @zappimoney/zappi-cli
zappi-cli login
```

Before the human saves a host-held allowance, install `zappi-allowance-spender` from `/spender/install` (Windows: `/spender/windows`) and run `zappi-cli pots spender`. Do not use npx.

## Output

`--json` may appear on any command. It prints the body. It does not print a session, a guest secret, a pot seed, a `zpc_` token, a device code, or an unlock token.

`need_choice` and a refusal returned as a body exit 0. `allowance_required` exits 1. An uncertain allowance pull exits with the spender's code. Exit 1 is also a transport failure, an unknown flag, an unknown command, or a missing login when the command needs an account.

`pots send` mints an idempotency key when `--idempotency-key` is omitted and includes that key in the JSON.

Defaults are the staging pair: API `https://api-dev.zappi.money`, app `https://dev.zappi.money`. Set `ZAPPI_API_URL` and `ZAPPI_APP_ORIGIN` together for production (`https://api.zappi.money` and `https://zappi.money`) or local (`http://localhost:3011` and `http://localhost:3000`). `SPARK_NETWORK` accepts `MAINNET`. Unset means `MAINNET`.

## Playbooks

Read one playbook for a login-door job. Leave the others closed.

| Skill | When |
| --- | --- |
| zappi-cli-account | `login`, `whoami`, `logout`, `guest`, `guest claim` |
| zappi-cli-pot | create, list, connect, disconnect, pair, balance, spender |
| zappi-cli-deposit | `deposit rails`, `deposit assets`, `deposit networks`, `deposit address` |
| zappi-cli-spend | `pots send`, allowance pull, approve URL, `txid` |

The playbooks ship next to this file under `skills/`.

## Usages

### This login

| Command | What it does |
| --- | --- |
| `zappi-cli whoami` | Account email, or guest mode |
| `zappi-cli login` / `zappi-cli logout` | Save or revoke this login |
| `zappi-cli guest` | Start a pot without an account |
| `zappi-cli guest claim --pot <id>` | Move that pot onto the account |
| `zappi-cli doctor` | Compare the saved login API with the resolved API. No secrets |
| `zappi-cli pots` | List pots on this login |
| `zappi-cli pots create [--label] [--skip-name]` | Create a pot. The only question is the name |
| `zappi-cli pots connect --pot <name-or-id> [--default]` | Connect a pot to this login |
| `zappi-cli pots disconnect --pot <name-or-id>` | Remove it from this login |
| `zappi-cli pots pair [--pot <id>]` | Approve URL |
| `zappi-cli pots balance [--pot <id>]` | Balance |
| `zappi-cli pots challenge --address <spark>` | Address challenge |
| `zappi-cli pots spender [pubkey] [--pot <id>]` | Register the allowance spender. Omit the key to read `zappi-allowance-spender pubkey` |
| `zappi-cli deposit rails [--pot <id>]` | Ways to add money |
| `zappi-cli deposit assets [--pot <id>]` | Assets |
| `zappi-cli deposit networks [--asset] [--pot <id>]` | Networks |
| `zappi-cli deposit address [--asset] [--network] [--pot <id>]` | Deposit address |
| `zappi-cli pots send assets [--pot <id>]` | Payout assets |
| `zappi-cli pots send networks [--asset] [--pot <id>]` | Payout networks |
| `zappi-cli pots send --amount-cents <n> --to <address> [--asset] [--chain] [--memo] [--pot] [--idempotency-key] [--spark-tx-id] [--no-wait]` | Send |
| `zappi-cli pots send-status <requestId> [--pot <id>]` | Read one send |

`pots create` sends `--label` and `--skip-name`. `--auth-choice skip` starts a guest when this login has never signed in. `--spend-mode`, `--limits`, `--per-payment`, and `--per-day` are accepted and not sent. Omit `--pot` for the default pot. Pass `--pot <id>` from create for a guest pot. A pot name does not reattach a guest pot.

### Host

```bash
zappi-cli propose
zappi-cli propose --generate [--label <name>] [--mode free|auth_required] [--origin <url>] [--key-file <path>] [--ref <code>] [--open]
zappi-cli propose --address <pot-address> [--label <name>] [--mode free|auth_required] [--origin <url>] [--ref <code>] [--open]
zappi-cli request --amount-cents <n> --to <spark-address> [--chain <chain>] [--memo <text>]
zappi-cli invite
```

Bare `propose` on a terminal asks: existing pot or a new one, spend mode, app origin when it is unset, then the label. A blank label confirms auto `pot_<unique>`. No terminal and no flags prints that usage and stops. Do not pass a recovery phrase as `--address`.

`request` needs `ZAPPI_POT_ID` and an attached host (`ZAPPI_POT_CLIENT_TOKEN` or `~/.zappi/pot-client-*.txt`). Its stdout is the approve URL. `invite` needs `ZAPPI_POT_ID` and takes no invite code.

### Local signer

```bash
zappi-cli sign <requestId> [--yes] [--signer <path>]
zappi-cli signer-status <requestId> [--signer <path>]
zappi-cli provision [args…]
zappi-cli prove-address [args…]
zappi-cli policy [args…]
zappi-cli backup [args…]
zappi-cli restore [args…]
```

The binary is `--signer`, otherwise `ZAPPI_SIGNER_BIN`, otherwise `zappi-signer` on `PATH`. `--yes` is the confirm an agent with a shell passes. Without it, a human confirms in the terminal. `--signer` is not passed to the child.

### Wallet

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
zappi-cli send --to <address-or-@user> --amount-cents <n> [--asset usdc|usdt|btc] [--network <id>] [--dry-run] [--idempotency-key <k>]
zappi-cli send internal --to <userId> --amount <cents> [--memo <text>] [--auth <token>]
zappi-cli send external --asset <a> --network <n> --address <addr> --amount <cents> [--auth <token>]
```

`balance` with `--pot`, or with `ZAPPI_POT_ID` set and no `--pot`, reads that pot. Otherwise it reads the wallet.

### Wallet pots

These run when the caller is a project key, or when `pots` is given `--origin` or `--spend-mode`.

```bash
zappi-cli pots list [--origin user|agent|unknown] [--spend-mode free|auth_required|unknown]
zappi-cli pots register <sparkAddress> [--label <name>] [--spend-mode free|auth_required]
zappi-cli pots deposit-address <id> [--source-chain <chain>]
zappi-cli pots grants <id> [--create] [--scopes read,deposit] [--revoke <grantId>]
zappi-cli pots spend-gate <id> [--action withdraw|internal_send|sweep]
zappi-cli pots spend-approvals <id> [--create --action withdraw|internal_send|sweep] [--amount <cents>] [--destination <addr>] [--approve <id>] [--reject <id>]
zappi-cli pots attach [--pot <potId>] [--spend-mode free|auth_required] [--spark-address <addr>] [--label <name>] [--no-poll]
zappi-cli pots attach-status <requestId>
zappi-cli pots bind <potId> [--label <name>] [--key-file <path>] [--no-poll]
zappi-cli pots registry <list|use|remove|import|bind|rotate-passphrase|backup|restore|unlock-secret>
```

Auth-required `pots attach` requires `--pot <potId>` or `ZAPPI_POT_ID`. If both are set they must match. The printed link is the approve URL. The device code and the `zpc_` token stay on this host.

## Commands that share a word

`pots connect` puts a pot on this login. `pots attach` is device-code pairing for a host key.

`pots send` sends on this login. `send` is the wallet send. `request` prints an approve URL for an auth-required host pot.

`deposit rails`, `deposit assets`, `deposit networks`, and `deposit address` are this login. `deposit-options` and `deposit-address` are the wallet.

`pots balance` is this login. `balance` is the wallet balance, and with `--pot` it reads a pot through the wallet client.

## Secrets

Do not print, log, or commit `ZAPPI_POT_SEED`, `ZAPPI_POT_CLIENT_TOKEN`, `ZAPPI_ATTACH_DEVICE_CODE`, `ZAPPI_UNLOCK_TOKEN`, `ZAPPI_POT_PASSPHRASE`, the guest secret, or the files under `~/.zappi/` that hold them. Do not ask the person to paste a session, a `zpc_` token, a pot seed, or a recovery phrase. On a failed command, stop and report. Do not read those files into the chat or call Nest with another HTTP client.
