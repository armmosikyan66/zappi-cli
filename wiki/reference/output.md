---
type: reference
tags: [cli, json, output]
updated: 2026-09-24
---

# Output

`stripJsonFlag` removes every `--json` before the command runs. Mode is `json` or `pretty`. Spinners (`ora`) run only when mode is `pretty` and stderr is a TTY. They write to stderr, not stdout.

## Modes

| Mode | When | Shape |
| --- | --- | --- |
| pretty | default TTY | Headings, `key  value` lines, success/warn colors (`picocolors`). |
| plain | tests and non-color paths | Stable single-line or few-line strings. |
| json | `--json` | `JSON.stringify(result, null, 2)`. |

Help (`--help`) is always plain text, even if `--json` is also passed.

Process failures: stderr gets `formatError` of the redacted message, exit code `1`. JSON error shape used by wallet helpers is `{ ok: false, error }` when those helpers format the error; the top-level `main` catch writes a formatted string, not that object, unless the thrown message already is JSON.

## `--json` contracts

**pay** (settle): `command`, `potId`, `sparkTxHash`, `network`, `asset`, `unlockTokenReceived` (boolean), plus `status`, `resourceId`, `priceCents`, `metered`, `autoConsume`, optional `unlockUrl`, `consume`, `notes`. Already unlocked: `status: "already_unlocked"`, `resourceId`, `potId`.

**request**: pretty/plain is the approve URL alone. `--json`: `ok`, `command`, `potId`, `requestId`, `approveUrl`, `amountCents`, `destinationAddress`. Never `zpc_`, never `code=` on the URL.

**consume**: `command`, `resourceId`, `units`, optional `grantRemaining`.

**propose**: `command`, `mode` (`generate` if a key-file line was parsed, else `flags`), `sparkAddress`, `href`, optional `keyFile`, `copied`.

**invite**: `command`, `inviteUrl`, `sharePath`.

**wallet / pots**: `{ ok: true, command, ...payload }`. Command string includes the subcommand when there is one (`"withdraw estimate"`, `"send internal"`, `"pots register"`).

Never included: mnemonic, `ZAPPI_POT_SEED`, unlock token values (`zpu_…`), pot client tokens (`zpc_…`) on `request` / `pay` / `consume`. 

> ⚠️ `pots attach` JSON includes `potClientToken` (`zpc_…`) when the poll returns one. Pretty mode prints `zpc_… (withheld)` instead. See [[commands/pots]].
