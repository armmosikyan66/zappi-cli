---
name: zappi-cli-deposit
description: List deposit assets and networks and return a standing deposit address, including USDC on Base for a guest free pot. Use when the user wants to deposit or needs a deposit address.
---

# Deposit

Commands: `zappi-cli deposit rails`, `zappi-cli deposit assets`, `zappi-cli deposit networks`, `zappi-cli deposit address`.

`zappi-cli deposit-options` and `zappi-cli deposit-address` are the wallet commands. This playbook is `zappi-cli deposit`.

Run `zappi-cli deposit address` with the asset and network the person named, plus `--pot <id>` when you have it. It returns the address, or `need_choice` when the rail is missing or ambiguous. Show those choices and stop. The command exits 0. Run `zappi-cli deposit assets` and `zappi-cli deposit networks` only when the person asks what they can deposit, or to fill in the half they did not name. `zappi-cli deposit rails` lists the ways to add money. `unsupported` means say so and repeat the list. Do not guess another asset.

A guest free pot has standing deposit addresses, including USDC on Base. When the person asks how to deposit and names no rail, one `zappi-cli deposit address` with no `--asset` or `--network` returns the choice list in one step. Signing in is not required. Pass `--pot <id>` from `zappi-cli pots create` for a guest pot. A pot name does not reattach a guest pot. A refusal that asks for `potId` means pass `--pot`. It does not mean the command is missing and it does not mean sign in.

## Presenting the address

Show the address as plain monospace text with the network in words, for example: Send USDC on Base to `<address>`. State that only the named asset and network will land in the pot. Do not generate a QR image. `sourceChain` is informational.
