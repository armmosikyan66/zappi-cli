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

After the human registers and funds the pot:

```bash
export ZAPPI_POT_ID="<from Zappi UI>"
# ZAPPI_POT_SEED and ZAPPI_UNLOCK_TOKEN are host secrets — never chat / never log
zappi-cli pay <paidResourceId>
# metered: pay auto-consumes one unit; more units:
zappi-cli consume <paidResourceId>
```

Never print or log `ZAPPI_POT_SEED` / `ZAPPI_UNLOCK_TOKEN`. Do **not** invent a chain from an address — `zappi-cli pay` reads 402 `accepts[0].network` + `asset` and only pays `spark` / `USDB`. Full docs: repository `README.md`.
