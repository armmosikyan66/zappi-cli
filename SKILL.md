---
name: zappi-agent-pot
description: Spend a prepaid Zappi pot to unlock a PaidResource. Install zappi-cli (zappi-cli) from GitHub. Never echo the pot key.
---

# Zappi agent pot (buyer)

Install the CLI:

```bash
npm i -g github:armmosikyan66/zappi-cli
zappi-cli propose --open
```

The wizard asks whether the pot already exists or should be generated, prompts
for a label (blank auto-names it `pot_<unique-id>`), then opens the register
link in your browser (ENTER to open, auto-opens after 5s, `c` to copy).

After the human registers and funds the pot, branch on spend mode.

Free pot (you hold the key):

```bash
export ZAPPI_POT_ID="<from Zappi UI>"
# ZAPPI_POT_SEED and ZAPPI_UNLOCK_TOKEN are host secrets — never chat / never log
zappi-cli pay <paidResourceId>
# metered: pay auto-consumes one unit; more units:
zappi-cli consume <paidResourceId>
```

Auth-required pot (human approves each spend). Do not run `pay`. Do not ask for `ZAPPI_ACCESS_TOKEN`, `zappi_access`, the pot seed, or a recovery phrase.

```bash
export ZAPPI_POT_ID="<from Zappi UI>"
export ZAPPI_POT_CLIENT_TOKEN="<zpc_ from attach approve — host secret>"
zappi-cli request --amount-cents 100 --to <spark-address>
```

That command needs no TTY. Stdout is **one approve URL** and nothing else (`https://zappi.money/?panel=pots&spend=<id>`, no `code=`). Paste that URL. The human opens it, sees the amount and destination, and approves with a passkey. The same ticket stays on the pot under **Spend to approve** if they never open the link. `--json` includes the URL and never the `zpc_` token. Approving records the decision. It does not send the money.

Never print or log `ZAPPI_POT_SEED`, `ZAPPI_POT_CLIENT_TOKEN`, or `ZAPPI_UNLOCK_TOKEN`. Do **not** invent a chain from an address — `zappi-cli pay` reads 402 `accepts[0].network` + `asset` and only pays `spark` / `USDB`. Full docs: repository `README.md`.
