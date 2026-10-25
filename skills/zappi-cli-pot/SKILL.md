---
name: zappi-cli-pot
description: Create a pot, list pots, connect one, start pairing, read a balance, or register the allowance spender. Use when creating a pot or answering with its Spark address.
---

# Pot

A Spark address is `sparkAddress` on `zappi-cli pots` or on the `zappi-cli pots create` result. Answer from that field. Do not search the repo or invent a local lookup to find it.

Commands: `zappi-cli pots`, `zappi-cli pots create`, `zappi-cli pots connect`, `zappi-cli pots disconnect`, `zappi-cli pots pair`, `zappi-cli pots balance`, `zappi-cli pots challenge --address <spark>`, `zappi-cli pots spender [pubkey]`.

`zappi-cli pots attach` is the device-code pairing command. Do not use it to connect a pot. Use `zappi-cli pots connect`.

There is no spend mode and no per-payment or per-day limit. The signed Spark allowance is the only cap. Read `zappi-cli-deposit` before a deposit. Read `zappi-cli-spend` before `zappi-cli pots send`.

## Create

Run `zappi-cli pots create` with no extra flags first. Do not ask the name before the command returns that question. Do not ask a spend mode or a limit.

- `need_choice` is one question. The question text is `message`. Each choice label is one option, in order. Do not add options. The command exits 0.
- When `field` is `name`, ask that question. Run again with `--label` set to the name they chose, or `--skip-name` when they skip.
- If this login is already signed in, do not ask how to continue and do not run `zappi-cli guest`. The pot is created on that account.
- A login that has never signed in can run `zappi-cli guest`, then `zappi-cli pots create`. `--auth-choice skip` on create still starts that guest and does not print the secret.
- A result is `status` `"active"`, `paired` true, `attachment` `"attached"`, and `sparkAddress`. Keep `potId`. The pot is on this login. Do not run `zappi-cli pots pair` when create already returned `paired: true`.

## Allowance

The only spending cap is a signed Spark allowance the human sets on the pot page. Until then, every send returns an approve URL.

Before they save a host-held allowance, run `zappi-cli pots spender`. That runs `zappi-allowance-spender pubkey` when no key is given and registers it on the default pot. Pass `--pot <id>` for a guest pot. Pass a 33-byte hex public key only when you already have one.

If `zappi-allowance-spender` is missing, install it from `/spender/install` (Windows: `/spender/windows`) and use the path it prints. Do not use npx. Do not ask the human to install it. Set `ZAPPI_ALLOWANCE_SPENDER_BIN` when the binary is not on PATH.

On `allowance_required`, do not register a spender. Ask once to set the allowance, then send again.

## After the login is still here

The login file and the guest file stay on this machine. Omit `--pot` for the default pot. Pass `--pot <id>` from the create result when a command asks for a pot. A pot name does not reattach a guest pot. Do not create a second pot while that pot still exists.

## List, connect, pair, balance

`zappi-cli pots` shows what is on this login. `session` `default` is the pot used when `--pot` is omitted. `session` `attached` is on this login. `session` `unattached` cannot be spent from, deposited to, or read on this login. `attachment` is wallet pairing, separate from `session`. `sparkAddress` is the pot address when it has one. On a fresh guest with no pot the list is empty. Pass `--pot <id>` when the list must include a guest pot.

`zappi-cli pots connect --pot <name-or-id>` puts one of this account's pots on this login. `--default` moves the default. The first one becomes the default.

`zappi-cli pots disconnect --pot <name-or-id>` removes a pot from this login. The pot and its funds stay on the account. This is not a revoke. Disconnecting the default clears it.

`zappi-cli pots pair` returns a `/pair` URL. Do not run it when create already returned `paired: true`.

`zappi-cli pots balance` reads the pot. Omit `--pot` for the default. Pass `--pot <id>` when the command asks for it.

`zappi-cli pots challenge --address <spark>` issues an address challenge. Create does not use it.
