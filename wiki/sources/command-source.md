---
type: source
title: CLI command source
author: zappi
date_published: 2026-09-22
date_ingested: 2026-09-22
source_path: packages/zappi-cli/src
tags: [cli, source]
updated: 2026-09-22
---

# Command source

Ingest of the dispatch and flag parsers. This page is the source of truth when [[sources/readme]] or `--help` is thinner than the code.

| Area | Files |
| --- | --- |
| Dispatch | `src/cli.ts` |
| Help | `src/ui.ts` `renderHelp` |
| Propose | `src/propose-register.ts`, `src/propose-wizard.ts`, `src/register-deep-link.ts`, `src/pot-key-file.ts` |
| Pay / consume | `src/paywall.ts`, `src/paywall-accept.ts`, `src/paywall-http.ts` |
| Invite | `src/invite-link.ts` |
| Wallet / withdraw / send | `src/wallet-commands.ts`, `src/deposit-commands.ts`, `src/withdraw-commands.ts` |
| Pots / attach | `src/pots-commands.ts`, `src/attach-commands.ts` |
| Shared flags | `src/args.ts` (`--flag value` and `--flag=value`) |
| Env | `src/env.ts` |
| Nest client | `src/client.ts` |
| Pot key load | `src/load-pot-seed.ts` |
| JSON shapes | `src/results.ts` (pay, consume, propose, invite) |

## Dispatch facts not obvious from the README

- `--json` is stripped in `main` before `runCli`. Help with `--json` is plain text, not a JSON blob.
- `balance` treats a set `ZAPPI_POT_ID` as pot scope even when `--pot` is omitted (`src/wallet-commands.ts`).
- `withdraw estimate` and `quote` accept `--bolt11` instead of `--address`, and optional `--sats` beside `--amount` (`buildWithdrawalRequest`).
- `pots` with no positional subcommand is `list`.
- `pots attach` opens the approve URL only in pretty mode and only when `--no-poll` is absent. It then polls every 2s for up to 15 minutes. `--json` still polls unless `--no-poll` is set. Pretty output prints `zpc_… (withheld)`; the JSON object includes `potClientToken` when nest returns one.
- `pots grants --create` without `--scopes` sends scopes `['read']`.
- `send internal` and `send external` build idempotency keys with `Date.now()`, so a retry is a new key.
- Direct-run detection resolves `argv[1]` through `realpathSync` so the `zappi-cli` symlink still enters `main`. Errors go to stderr via `formatError(redactSecrets(message))` and exit code 1.

Filed into [[usages]] and the command pages.
