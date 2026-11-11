---
name: zappi-cli-spend
description: Spend from a pot with zappi-cli pots send. Use when the user wants to pay, send, or move funds. The signed Spark allowance is the only cap.
---

# Spend

The send command is `zappi-cli pots send --amount-cents <n> --to <address>`. `zappi-cli pots send assets` and `zappi-cli pots send networks` list payout rails. Run those two only when the person asks what they can send to. `zappi-cli send` is the wallet send. Do not use it for this login.

`--pot` selects by name or id from `zappi-cli pots`. Omitting it asks which pot. Pass `--pot <id>` from `zappi-cli pots create` for a guest pot. A refusal that asks for `potId` means pass `--pot`.

There is no per-payment limit and no per-day limit. The signed Spark allowance is the only cap. Do not put a limit on send. Do not offer a limits link.

Run `zappi-cli pots send` once with `--amount-cents` and `--to`, and only the asset and chain the person named (`--asset`, `--chain`). Do not pass the payout chain as a network. The account network is separate. Do not read deposit assets or deposit networks to choose a payout. Rails are point-in-time: resolve on every send and do not cache the catalog across turns.

The CLI mints an idempotency key when `--idempotency-key` is omitted and includes that key in the JSON. Keep it. Never reuse a key after the fields change. A follow-up after `allowance_pull` uses the returned `requestId` as the idempotency key. Do not invent a new one for that follow-up.

A Spark address needs no chain. An `0x` address needs `--chain`. Pass `--memo` when the person gives a memo or tag for an exchange deposit.

- On `need_choice`, show each `label` when the result has one, otherwise `networkName` and `asset`, copied exactly, in that order. Do not paraphrase into prose or invent a fee. Then run `zappi-cli pots send` again with those flags. The command exits 0. Do not pick a chain because it appeared on a deposit list. In a terminal, the command asks and sends again itself.
- On any refusal (`wrong_family`, `unsupported`, `too_small`, `memo_required`, `insufficient_funds`, `self_send`, `catalog_unavailable`, `quote_expired`, `balance_unavailable`), surface the reason verbatim to the person and stop. Do not retry unchanged, and do not retry with a different chain. `quote_expired` means nothing moved; a later send needs a new idempotency key.
- On `pending_recovery`, tell the person the transfer is in flight with the `txid` and never send again for that request.
- Treat the `next` field of every response as the instruction.
- On `idempotency_conflict`, generate a new key.
- On `allowance_pull`, the command runs `zappi-allowance-spender pull --allowance-id <allowanceId> --owner-public-key <ownerPublicKey> --token-identifier <tokenIdentifier> --receiver-public-key <receiverPublicKey> --amount <tokenAmount>`, then sends again with `--idempotency-key <requestId>` and `--spark-tx-id <txId>`. The pull pays `receiverSparkAddress`, even when that is a payout deposit for another chain. Do not change the destination to that deposit address. If the spender is missing, install it from `/spender/install` (Windows: `/spender/windows`). Do not use npx. If the pull result is uncertain, report it once and do not send again.
- On an approve URL, give that URL to the person. The command polls `zappi-cli pots send-status <requestId>` unless `--no-wait` is set. The person approves it in the Zappi web app. `--no-wait` prints the URL and stops.
- On `allowance_required`, stop and ask once to set the allowance on the pot page, then send again. Do not register a spender because of this status. The command exits 1.
- On `need_browser`, show the pot page and stop. Do not pull.
- Success is `status` `"settled"` with `txid`. Follow `next`. When it is settled, stop. Do not send the payment again.
- There is no local signer in this flow. Do not run a sign command.
- Never ask for or relay a recovery phrase. The server does not return one.
