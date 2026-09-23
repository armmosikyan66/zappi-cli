---
type: source
title: zappi-agent-pot skill
author: zappi
date_published: 2026-09-22
date_ingested: 2026-09-22
source_path: packages/zappi-cli/SKILL.md
tags: [cli, skill, agents]
updated: 2026-09-22
---

# Agent skill

Ingest of `packages/zappi-cli/SKILL.md` (`name: zappi-agent-pot`). This is the short agent-facing card. Full command lines are [[usages]].

## Takeaways

- Install line the skill gives agents: `npm i -g github:armmosikyan66/zappi-cli`, then `zappi-cli propose --open`.
- Wizard: existing pot or generate, label (blank → `pot_<unique-id>`), then open the register link (ENTER, auto-open after 5s, `c` to copy).
- After the human registers and funds: set `ZAPPI_POT_ID`, keep `ZAPPI_POT_SEED` and `ZAPPI_UNLOCK_TOKEN` as host secrets, then `pay` and `consume`.
- `pay` reads 402 `accepts[0].network` + `asset` and only pays `spark` / `USDB`.
- `invite` prints a Nest URL or fails closed (`INVITE_AFFILIATE_DISABLED`, `INVITE_LINK_MISSING`).
- Wallet sketch matches the developer surface: balance, transactions, deposit, withdraw, send, pots. Signing uses the two-phase orchestrator; the pot key stays on the host.

The skill points agents at repository `README.md` ([[sources/readme]]) for the rest.
