---
type: command
tags: [cli, paywall, spend]
updated: 2026-09-24
---

# pay

Agent spend after the pot is funded. Unlocks a nest `PaidResource`.

```bash
zappi-cli pay <resourceIdOrUrl> [--no-consume] [--units N] [--json]
```

`<resourceIdOrUrl>` is a slug/UUID (`^[a-zA-Z0-9_-]+$`) or a URL whose path matches `/api/paywall/resources/:id`.

## Required env

- `ZAPPI_POT_ID` — missing → `Set ZAPPI_POT_ID (from the Zappi pot install snippet).`
- `ZAPPI_POT_SEED` or `ZAPPI_POT_KEY_FILE` — loaded by [[reference/auth]]. Placeholders wrapped in `<…>` are rejected.
- `ZAPPI_POT_SPEND_MODE=auth_required` refuses before any sign: `This pot is auth_required. Do not free-sign with pay. Run \`zappi-cli request --amount-cents <cents> --to <spark-address>\` and paste the approve URL.` See [[commands/request]] and [[sources/skill]].

Paywall origin: `ZAPPI_PAYWALL_BASE`, else `ZAPPI_API_URL`, else `https://api.zappi.money`.

## Steps

1. `GET` the resource. HTTP 200 → status `already_unlocked` (no spend).
2. Anything other than 402 throws.
3. Read `accepts[0]` only. Missing `payTo`, missing `extra.priceCents`, missing `network`, or missing `asset` fails. Network and asset are **not** inferred from the address shape.
4. Only `spark` / `USDB` (case-insensitive network, asset uppercased) is payable. Any other rail throws and does not sign.
5. Read the pot’s USDB token id (account `0`, `SPARK_NETWORK`) and sign `priceCents` USDB to `payTo`.
6. Settle `{ resourceId, potId, sparkTxHash }` with retry. Non-200 throws a redacted message.
7. Unlock bearer from the first settle is **not** printed. `unlockTokenReceived` is a boolean. `unlockUrl` is included when nest returns it (exact / `url_once` resources stop after settle; use that URL).
8. If pricing is metered (`extra.pricingMode=metered` or `extra.unlockMode=metered_grant`) and a first-unlock token exists, consume `--units` (default 1) in the same `pay`. `--no-consume` skips that and tells you to run [[commands/consume]].

Empty pot is a stop. Do not fall back to the main wallet.

## Output

Pretty/plain never include the mnemonic, seed, or `zpu_…` / `zpc_…` values. JSON fields on settle: `command`, `status`, `resourceId`, `potId`, `priceCents`, `network`, `asset`, `sparkTxHash`, `unlockTokenReceived`, optional `unlockUrl`, `metered`, `autoConsume`, optional `consume`, `notes`.

Spinner labels (TTY stderr only): Checking resource → Reading pot USDB token → Signing N¢ USDB → Settling payment → Consuming N unit(s). Failure: `Pay failed`.
