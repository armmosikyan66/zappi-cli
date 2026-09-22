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

`zappi-cli login` is optional and only when the human asks to sign **this**
terminal into their Zappi account. It opens the normal Zappi sign-in screen
(email or passkey). Do not run it for an agent host, and never print
`~/.zappi/credentials.json`.

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

Never print or log `ZAPPI_POT_SEED` / `ZAPPI_UNLOCK_TOKEN`. Do **not** invent a chain from an address — `zappi-cli pay` reads 402 `accepts[0].network` + `asset` and only pays `spark` / `USDB`. Do **not** invent an invite code — `zappi-cli invite` prints a Nest URL for `ZAPPI_POT_ID` or fails closed (`INVITE_AFFILIATE_DISABLED`, `INVITE_LINK_MISSING`). Full docs: repository `README.md`.

## Wallet & pots (developer)

The CLI also mirrors the `@zappimoney/zappi-sdk` wallet surface. Set
`ZAPPI_PROJECT_API_KEY` (server-to-server) or `ZAPPI_ACCESS_TOKEN` (user
session) to call nest wallet routes; signing routes also use
`ZAPPI_POT_SEED`:

```bash
zappi-cli balance [--pot <id>]
zappi-cli transactions [<id>]
zappi-cli deposit-options
zappi-cli deposit-address --asset <a> --network <n>
zappi-cli withdraw-options
zappi-cli withdraw estimate|quote|confirm|status ...
zappi-cli send internal|external ...
zappi-cli pots [list|register|deposit-address|grants|spend-gate|spend-approvals|attach|attach-status] ...
```

`withdraw confirm` and `send internal`/`send external` sign Spark USDB from
the host pot seed via the two-phase orchestrator; the pot key never leaves the
host.
