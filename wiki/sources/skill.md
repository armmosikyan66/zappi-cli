---
type: source
title: zappi-agent-pot skill
author: zappi
date_published: 2026-09-22
date_ingested: 2026-09-22
source_path: packages/zappi-cli/SKILL.md
tags: [cli, skill, agents]
updated: 2026-09-24
---

# Agent skill

Ingest of `packages/zappi-cli/SKILL.md` (`name: zappi-agent-pot`). This is the **only** published buyer skill. Agents load this file first. Full command lines are [[usages]].

## Takeaways

- Propose line: `npx @zappimoney/zappi-cli propose` (no global install).
- Wizard: existing pot or generate, spend mode, network (unless `SPARK_NETWORK` is set), app origin (unless origin env is set), label (blank confirms auto `pot_<unique>` vs a custom name), then open the register link.
- Loading the skill, `npx @zappimoney/zappi-cli`, a pot id, or **connect** is **not** a send. Auth-required: the pot is not attached until `pots attach` is approved. Until then the bot cannot `request`, `pay`, `consume`, or `invite`. Pairing URL + user code only. Never ask for `zpc_`.
- Free pot: set `ZAPPI_POT_ID`, keep `ZAPPI_POT_SEED` and `ZAPPI_UNLOCK_TOKEN` as host secrets, then `pay` and `consume`. `pay` reads 402 `accepts[0].network` + `asset` and only pays `spark` / `USDB`.
- Auth-required: attach first. After pairing is approved, wait until the human asks to send (amount-cents + Spark address). Then [[commands/request]]. If `request` says not attached, run `pots attach` — never ask them to paste `zpc_`.
- `invite` prints a Nest URL or fails closed (`INVITE_AFFILIATE_DISABLED`, `INVITE_LINK_MISSING`). On `auth_required` it also fails closed until this host is attached.

The skill points agents at repository `README.md` ([[sources/readme]]) for the rest.
