---
name: zappi-agent-pot
description: Spend a prepaid Zappi pot to unlock a PaidResource. Install zappi-cli (zappi-pot) from GitHub. Never echo the pot key.
---

# Zappi agent pot (buyer)

Install the CLI:

```bash
npm i -g github:armmosikyan66/zappi-cli
zappi-pot propose --generate --open
```

After the human registers and funds the pot:

```bash
export ZAPPI_POT_ID="<from Zappi UI>"
# ZAPPI_POT_SEED and ZAPPI_UNLOCK_TOKEN are host secrets — never chat / never log
zappi-pot pay <paidResourceId>
# metered: pay auto-consumes one unit; more units:
zappi-pot consume <paidResourceId>
```

Never print or log `ZAPPI_POT_SEED` / `ZAPPI_UNLOCK_TOKEN`. Full docs: repository `README.md`.
