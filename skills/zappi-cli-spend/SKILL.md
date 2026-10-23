---
name: zappi-cli-spend
description: Spend from a pot with zappi-cli pots send. Use when the user wants to pay, send, or move funds.
---

# Spend

The send command is `zappi-cli pots send --amount-cents <n> --to <address>`. `zappi-cli pots send assets` and `zappi-cli pots send networks` list payout rails. Run those two only when the person asks what they can send to. `zappi-cli send` is the wallet send. Do not use it for this login.

`--pot` selects by name or id from `zappi-cli pots`. Omit it for the default. Pass `--pot <id>` from `zappi-cli pots create` for a guest pot. A refusal that asks for `potId` means pass `--pot`.

A new pot is $50 per payment and $200 per day unless the person chose custom limits when it was created. `zappi-cli pots` and `zappi-cli pots create` include those numbers and one `limitsUrl`. Give the person that link. A guest opens it and approves; the pot page opens after approval. A signed-in link is the pot page. On `over_limit`, show the same link and stop. Do not ask them to type a replacement on send. Do not put a limit on send. Do not offer a second link.

Run `zappi-cli pots send` once with `--amount-cents` and `--to`, and only the asset and chain the person named (`--asset`, `--chain`). Do not pass the payout chain as a network. The account network is separate. Do not read deposit assets or deposit networks to choose a payout. Rails are point-in-time: resolve on every send and do not cache the catalog across turns.

The CLI mints an idempotency key when `--idempotency-key` is omitted and includes that key in the JSON. Keep it. Never reuse a key after the fields change.

A Spark address needs no chain. An `0x` address needs `--chain`. Pass `--memo` when the person gives a memo or tag for an exchange deposit.

- On `need_choice`, show `networkName` and `asset`, ask the person, then run `zappi-cli pots send` again with those flags. The command exits 0. Do not pick Base because it appeared on a deposit list.
- On any refusal (`wrong_family`, `unsupported`, `too_small`, `memo_required`, `insufficient_funds`, `self_send`, `catalog_unavailable`, `quote_expired`, `balance_unavailable`), surface the reason verbatim to the person and stop. Do not retry unchanged, and do not retry with a different chain. `quote_expired` means nothing moved; a later send needs a new idempotency key.
- On `pending_recovery`, tell the person the transfer is in flight with the `txid` and never send again for that request.
- Treat the `next` field of every response as the instruction.
- On `idempotency_conflict`, generate a new key.
- An auth-required pot returns a bare `approveUrl` for a Spark address. Give that URL to the person and stop. The person approves it in the Zappi web app. Another network from that pot is refused. Do not open a ticket for it.
- A free pot is signed by the server. Success is `status` `"settled"` with `txid`, `asset`, `networkId`, `destinationAddress`, `requestId`, `potId`, and `amountCents`. Follow `next`. When it is settled, stop. Do not send the payment again.
- Never ask for or relay a recovery phrase. The server does not return one.
