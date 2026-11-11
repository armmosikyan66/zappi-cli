---
name: zappi-cli-deposit
description: List deposit assets and networks and return a standing deposit address, including USDC on Base for a guest free pot. Use when the user wants to deposit or needs a deposit address.
---

# Deposit

Commands: `zappi-cli deposit assets`, `zappi-cli deposit networks`, `zappi-cli deposit address`.

`zappi-cli deposit rails` is not the deposit question. It returns the same currency list as `deposit assets`. Do not start a deposit there.

`zappi-cli deposit-options` and `zappi-cli deposit-address` are the wallet commands. This playbook is `zappi-cli deposit`.

A deposit with nothing named runs `zappi-cli deposit assets` and asks the currency. Then `zappi-cli deposit networks --asset` and asks the network. Then `zappi-cli deposit address --asset --network` with no `--amount-cents`, plus `--pot <id>` when you have it. Show the address or Lightning Address on its own line. State the network minimum. Say they can send any amount at or above that minimum. Ask for an amount only for a Lightning invoice, then pass `--amount-sats`. Do not run `deposit address` with no asset. `need_choice` means ask that question and stop. The command exits 0. `unsupported` means say so and repeat the asset list. Do not guess another asset. Do not show asset and network pairs in one list.

Pass `--pot <id>` from `zappi-cli pots create` for a guest pot. A pot name does not reattach a guest pot. A refusal that asks for `potId` means pass `--pot`. It does not mean the command is missing and it does not mean sign in.

## Presenting the address

Show the address or Lightning Address on its own line as plain monospace text, and name the network in words. State that only the named asset and network will land in the pot. Do not generate a QR image. `sourceChain` is informational.
