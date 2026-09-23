---
type: reference
tags: [cli, security]
updated: 2026-09-22
---

# Hard rules

From [[sources/readme]], [[sources/skill]], and the fail-closed checks in source.

- Never print, log, `echo`, or `set -x` `ZAPPI_POT_SEED`, the key file body, or `ZAPPI_UNLOCK_TOKEN`.
- Never pass a recovery phrase as `--address` or put one in a deep link. Propose rejects phrases and tells you to pass the public pot address.
- Nest never holds the pot key. The cap in v1 is an empty pot. Revoking a grant does not delete a key already on the host. Disconnect cannot stop on-chain spend.
- Do not invent a payment chain or asset from an address. [[commands/pay]] requires 402 `accepts[0].network` and `accepts[0].asset` and only pays `spark` / `USDB`.
- Do not invent an invite code. [[commands/invite]] prints a Nest URL or fails closed.
- Do not fall back to the main wallet when the pot is empty.
- Scripts should use `ZAPPI_UNLOCK_TOKEN`, not `--unlock-token`, so the bearer stays out of `ps` and shell history.
- `auth_required` pots must not be free-signed from `pay`. Approve in Zappi.
- Seller / project API is out of scope.
- Stderr and paywall errors run through `redactSecrets` (including BIP-39-shaped strings) before they are shown.
- `@typesafe-ai/sdk` stays in eval only. Do not import it from the buyer CLI.

Store the attach client token (`zpc_…`) as a host secret. Pretty attach output withholds it; `--json` does not ([[reference/output]]).
