---
name: zappi-cli-pot
description: Create a pot, list pots, connect one, start pairing, or read a balance. Use when creating a pot or answering with its Spark address.
---

# Pot

A Spark address is `sparkAddress` on `zappi-cli pots` or on the `zappi-cli pots create` result. Answer from that field. Do not search the repo or invent a local lookup to find it.

Commands: `zappi-cli pots`, `zappi-cli pots create`, `zappi-cli pots connect`, `zappi-cli pots disconnect`, `zappi-cli pots pair`, `zappi-cli pots balance`, `zappi-cli pots challenge --address <spark>`.

`zappi-cli pots attach` is the device-code pairing command. Do not use it to connect a pot. Use `zappi-cli pots connect`.

A free pot is sealed by the server. `zappi-cli pots create --spend-mode free` returns the Spark address. `zappi-cli pots send` is signed by the server. Read `zappi-cli-deposit` before a deposit. Read `zappi-cli-spend` before `zappi-cli pots send`.

## Create

Run `zappi-cli pots create` with no extra flags first. Do not ask the spend mode, the name, or the limits before the command returns them.

After the name, the command asks which spending limits to use. `--limits default` keeps $50 per payment and $200 per day. `--limits custom` is the limits form. When `status` is `need_form`, ask for the two dollar amounts in that form, with the defaults filled. Then run `zappi-cli pots create` again with `--limits custom --per-payment <dollars> --per-day <dollars>`, and keep the spend mode, label or `--skip-name`, and `--auth-choice`. Amounts are US dollars. 0 pauses that limit. The per-payment amount cannot be higher than the daily amount. Do not invent amounts.

After the pot exists, tell the person the limits in the result and give the one `limitsUrl`. A guest link is authorize-then-edit: they open it and approve, and the pot page opens after approval. A signed-in link is the pot page. Do not offer a second link. `zappi-cli pots` returns the same numbers and the same kind of link. That link is where the limit is changed later.

- `need_choice` is one question. The question text is `message`. Each choice label is one option, in order. Do not add options. The command exits 0.
- `spendMode`: `auth_required` (a person approves each payment) or `free` (the server signs each payment). Run `zappi-cli pots create --spend-mode free` or `--spend-mode auth_required`.
- An `auth_required` choice on a login that has never signed in returns `authorization_required`. Run `zappi-cli login`, then create again. Do not start a second login when `whoami` already shows the account.
- If this login is already signed in, do not ask how to continue. Run `zappi-cli pots create --spend-mode free`. Do not run `zappi-cli guest`. The pot is created on that account.
- A `free` choice asks **Continue authenticated** or **Skip — create without signing in** only when this login has never signed in.
- Continue authenticated: run `zappi-cli login` when this login has never signed in, then `zappi-cli pots create --spend-mode free`. The pot is created on that account.
- Skip: run `zappi-cli pots create --spend-mode free --auth-choice skip`. That stores a guest secret and does not print it. The next result is the name question. Do not stop after the choice.
- If the first message already asks for a guest pot and does not give a name, run `zappi-cli pots create --spend-mode free --auth-choice skip --skip-name`. Do not ask those questions first. The limits question still comes from the command unless `--limits` is already set.

## create flow

1. Run `zappi-cli pots create`.
2. When `status` is `need_choice` and `field` is `spendMode`, ask that question and run again with `--spend-mode free` or `--spend-mode auth_required`.
3. If this login is already signed in, do not ask Continue authenticated or Skip. Pass `--spend-mode free`. On a login that has never signed in, a free choice returns Continue authenticated or Skip. Follow the section above.
4. When `field` is `name`, ask that question. Run again with `--label` set to the name they chose, or `--skip-name` when they skip.
5. When `field` is `limits`, ask that question. Default runs again with `--limits default`. Custom runs again with `--limits custom`, and a `need_form` result is the two dollar amounts: `--per-payment` and `--per-day`.
6. A free result is `status` `"active"`, `paired` true, `attachment` `"attached"`, and `sparkAddress`. Keep `potId`. The pot is on this login. Do not run `zappi-cli pots pair`.
7. An auth-required result is `paired` true and `attachment` `"attached"`. There is no wallet step. Reply with the pot name, the spend mode, the limits, and that it is attached.

## After the login is still here

The login file and the guest file stay on this machine. Pass `--pot <id>` from the create result when a command asks for a pot. A pot name does not reattach a guest pot. Do not create a second pot while that pot still exists.

## List, connect, pair, balance

`zappi-cli pots` shows what is on this login. `session` `default` is the pot used when `--pot` is omitted. `session` `attached` is on this login. `session` `unattached` cannot be spent from, deposited to, or read on this login. `attachment` is wallet pairing, separate from `session`. `sparkAddress` is the pot address when it has one. On a fresh guest with no pot the list is empty. Pass `--pot <id>` when the list must include a guest pot.

`zappi-cli pots connect --pot <name-or-id>` puts one of this account's free pots on this login. `--default` moves the default. The first one becomes the default. An auth-required pot is refused.

`zappi-cli pots disconnect --pot <name-or-id>` removes a pot from this login. The pot and its funds stay on the account. This is not a revoke. Disconnecting the default clears it. To move a pot to another agent, disconnect it here. That agent runs `zappi-cli pots connect` for a free pot, or `zappi-cli pots pair` for an auth-required pot.

`zappi-cli pots pair` returns a `/pair` URL. The person approves an auth-required pot there. A free pot does not use that page: create it, or run `zappi-cli pots connect`. Do not run `zappi-cli pots pair` when create already returned `paired: true`.

`zappi-cli pots balance` reads the pot. Omit `--pot` for the default. Pass `--pot <id>` when the command asks for it.

`zappi-cli pots challenge --address <spark>` issues an address challenge. Free-pot create does not use it.
