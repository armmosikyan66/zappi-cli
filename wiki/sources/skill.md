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

- Propose line the skill gives agents: `npx @zappimoney/zappi-cli propose` (no global install).
- Wizard: existing pot or generate, spend mode, network (unless `SPARK_NETWORK` is set), app origin (unless origin env is set), label (blank confirms auto `pot_<unique>` vs a custom name), then open the register link.
- After the human registers and funds: set `ZAPPI_POT_ID`, keep `ZAPPI_POT_SEED` and `ZAPPI_UNLOCK_TOKEN` as host secrets, then `pay` and `consume`.
- `pay` reads 402 `accepts[0].network` + `asset` and only pays `spark` / `USDB`.
- `invite` prints a Nest URL or fails closed (`INVITE_AFFILIATE_DISABLED`, `INVITE_LINK_MISSING`).
- Wallet sketch matches the developer surface: balance, transactions, deposit, withdraw, send, pots. Signing uses the two-phase orchestrator; the pot key stays on the host.

The skill points agents at repository `README.md` ([[sources/readme]]) for the rest.
