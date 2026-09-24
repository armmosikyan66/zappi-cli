---
type: command
tags: [cli, paywall, spend]
updated: 2026-09-22
---

# consume

Further units of a metered grant after [[commands/pay]].

```bash
zappi-cli consume <resourceIdOrUrl> [--units N] [--unlock-token <token>] [--json]
```

`POST …/consume` with header `X-Zappi-Unlock-Token` and body `{ units }`.

## Token

`ZAPPI_UNLOCK_TOKEN` wins over `--unlock-token` when both are set, so scripts keep the bearer out of `ps` and shell history. Missing token, or a `<placeholder>`, throws and tells you not to paste it into chat.

On `ZAPPI_POT_SPEND_MODE=auth_required`, consume also requires this host to be attached (`zpc_` env or `~/.zappi/pot-client-*.txt`). Otherwise it fails closed with the not-attached error — run [[commands/pots]] `attach`. Do not ask the human to paste `zpc_`.

`--units` must be a positive integer. Default `1`.

## Output

Success: `command: "consume"`, `resourceId`, `units`, optional `grantRemaining` from the 200 body. The token value is not in stdout. Non-200 throws a redacted error. Spinner: `Consuming…` / `Consumed` / `Consume failed`.

Exact (`url_once`) resources do not use this command; they stop after settle ([[commands/pay]]).
