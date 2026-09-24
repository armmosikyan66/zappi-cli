---
type: command
tags: [cli, pots, spend, auth]
updated: 2026-09-24
---

# request

Auth-required agent spend. Creates a Nest spend ticket and prints **only** the human approve URL. Does not sign. Agent card: [[sources/skill]].

```bash
zappi-cli request --amount-cents <cents> --to <spark-address> [--chain <chain>] [--memo <text>] [--json]
```

Needs no TTY. Source: `src/spend-request.ts`.

## Required env

- `ZAPPI_POT_ID` — public pot id from the Zappi prompt.
- `ZAPPI_POT_CLIENT_TOKEN` — `zpc_` from attach approve, or `~/.zappi/pot-client-*.txt` after reclaim. Host secret. Env only — never a CLI flag (`ps` / history). Placeholders and non-`zpc_` values (session JWTs, seeds, phrases) are rejected. Missing token = this pot is not attached.

If the pot is not attached, this command fails closed and tells the agent to run `pots attach`. Agents must **never** prompt for a `zpc_` paste. Pairing is URL + user code.

Paywall origin: `ZAPPI_PAYWALL_BASE`, else `ZAPPI_API_URL`, else `https://api.zappi.money`. Approve URL origin: `ZAPPI_APP_ORIGIN` (default `https://zappi.money`).

## Flags

| Flag | Notes |
| --- | --- |
| `--amount-cents` | Required. Positive integer. 100 = $1. |
| `--to` | Required. Destination Spark address. Mnemonic-shaped values fail. |
| `--chain` | Optional destination chain. Mnemonic-shaped values fail. |
| `--memo` | Optional memo. Mnemonic-shaped values fail. |
| `--json` | Machine-readable object. Still never includes `zpc_`. |

Rejected flags: `--seed`, `--mnemonic`, `--phrase`, `--recovery`, `--access-token`, `--session-token`, `--client-token`, `--pot-seed`, `--unlock-token`. Message: set `ZAPPI_POT_CLIENT_TOKEN` as a host secret and paste only the approve URL.

## Steps

1. POST `/api/wallet/self-custody/pots/$ZAPPI_POT_ID/spend-requests` with header `x-zappi-pot-client` and body `{ amountCents, destinationAddress }` (plus optional `destinationChain`, `memo`).
2. Expect 200 or 201 and a ticket `id`.
3. Build or strip the approve URL to `/?panel=pots&spend=<id>` with **no** `code=` and **no** `zpc_`. If the URL would leak either, refuse to print it.

The human opens that URL, sees amount and destination, and approves with a passkey. The device that holds the pot key signs and broadcasts. This command does not poll for `sparkTxHash`. Approving records the decision; it does not itself send the money.

`ZAPPI_POT_SPEND_MODE=auth_required` makes [[commands/pay]] refuse and point at this command.

## Output

Pretty / plain: the approve URL alone.

`--json`: `ok`, `command` (`request`), `potId`, `requestId`, `approveUrl`, `amountCents`, `destinationAddress`. Never the `zpc_` token.

One human ask → one `request` call. Do not create a duplicate for the same send. The ticket stays on the pot under **Spend to approve** if they never open the link.
