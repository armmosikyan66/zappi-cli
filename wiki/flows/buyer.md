---
type: flow
tags: [cli, pots, paywall]
updated: 2026-09-24
---

# Buyer flow

propose → fund → pay **or** request → consume. Command details: [[commands/propose]], [[commands/pay]], [[commands/request]], [[commands/consume]].

1. **Propose** on the agent host. The CLI generates the pot key there (or accepts an existing public address) and opens a register URL. The human signs in to Zappi and taps Register. The CLI never prints the key.
2. **Fund** in the Zappi app. This step does not call deposit APIs. Developer deposit commands on [[commands/wallet]] and [[commands/pots]] are a different surface and need [[reference/auth]].
3. **Pay** (free pot) after `ZAPPI_POT_ID` and `ZAPPI_POT_SEED` (or key file) are set. Nest returns an unlock bearer once on first settle. The CLI withholds that token from stdout and logs. Metered resources auto-consume one unit unless `--no-consume`.
4. **Request** (auth-required pot) only after this host is **attached** (`pots attach` approved). Until then the bot cannot `request`, `pay`, `consume`, or `invite`. `zappi-cli request` prints one approve URL. If it says not attached, run attach — never ask for a `zpc_` paste. The human approves in Zappi. This command does not sign. Agent card: [[sources/skill]].
5. **Consume** further metered units with `ZAPPI_UNLOCK_TOKEN`. Exact (`url_once`) resources stop after settle; use `unlockUrl` when nest returns it.

Empty pot = stop. Do not spend the main wallet.

## Staging dogfood

```bash
export ZAPPI_API_URL=https://api-dev.zappi.money
export ZAPPI_APP_ORIGIN=http://dev.zappi.money
export ZAPPI_POT_ID='<pot id>'
# ZAPPI_POT_SEED / ZAPPI_POT_CLIENT_TOKEN / ZAPPI_UNLOCK_TOKEN are host secrets — never echo, never commit

zappi-cli propose --generate --label Staging --open
zappi-cli pay '<paidResourceId>'
zappi-cli consume '<paidResourceId>' --units 1
# auth-required instead of pay:
# zappi-cli request --amount-cents 100 --to <spark-address>
```

Production paywall is the default (`https://api.zappi.money`) when those exports are unset.

## Agent card

The published skill is [[sources/skill]] (`zappi-agent-pot` / `SKILL.md`). Setup, free `pay` / `consume`, and auth-required `request` are in that one file. Invite is optional and fail-closed ([[commands/invite]]).
