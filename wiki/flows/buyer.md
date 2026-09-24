---
type: flow
tags: [cli, pots, paywall]
updated: 2026-09-22
---

# Buyer flow

propose → fund → pay → consume. Command details: [[commands/propose]], [[commands/pay]], [[commands/consume]].

1. **Propose** on the agent host. The CLI generates the pot key there (or accepts an existing public address) and opens a register URL. The human signs in to Zappi and taps Register. The CLI never prints the key.
2. **Fund** in the Zappi app. This step does not call deposit APIs. Developer deposit commands on [[commands/wallet]] and [[commands/pots]] are a different surface and need [[reference/auth]].
3. **Pay** after `ZAPPI_POT_ID` and `ZAPPI_POT_SEED` (or key file) are set. Nest returns an unlock bearer once on first settle. The CLI withholds that token from stdout and logs. Metered resources auto-consume one unit unless `--no-consume`.
4. **Consume** further metered units with `ZAPPI_UNLOCK_TOKEN`. Exact (`url_once`) resources stop after settle; use `unlockUrl` when nest returns it.

Empty pot = stop. Do not spend the main wallet.

## Staging dogfood

```bash
export ZAPPI_API_URL=https://api-dev.zappi.money
export ZAPPI_APP_ORIGIN=http://dev.zappi.money
export ZAPPI_POT_ID='<pot id>'
# ZAPPI_POT_SEED / ZAPPI_UNLOCK_TOKEN are host secrets — never echo, never commit

zappi-cli propose --generate --label Staging --open
zappi-cli pay '<paidResourceId>'
zappi-cli consume '<paidResourceId>' --units 1
```

Production paywall is the default (`https://api.zappi.money`) when those exports are unset.

## Agent card

The short version agents should follow is [[sources/skill]]: `npx @zappimoney/zappi-cli propose` (the wizard asks for missing settings), then pay/consume without echoing secrets. Invite is optional and fail-closed ([[commands/invite]]).
