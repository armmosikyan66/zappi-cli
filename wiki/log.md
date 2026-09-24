---
type: log
tags: [meta]
updated: 2026-09-24
---

# Wiki Log

## [2026-09-24] ingest | Unattached auth-required pot is fail-closed
- touched: wiki/sources/skill.md, wiki/commands/request.md, wiki/commands/invite.md, wiki/reference/hard-rules.md, wiki/reference/environment.md, wiki/usages.md, wiki/flows/buyer.md, wiki/sources/command-source.md
- notes: Until `pots attach` is approved, the bot cannot `request`, `pay`, `consume`, or `invite`. Missing `zpc_` means not attached — run attach (URL + user code), never ask for a paste. `request` also reads `~/.zappi/pot-client-*.txt` after reclaim.

## [2026-09-24] ingest | Combine SKILL.md (one buyer skill)
- deleted: wiki/sources/skill-spend.md, packages/zappi-cli/SKILL-spend.md, web/examples/agent-pot-spend/, web/public/.well-known/agent-skills/zappi-agent-pot-spend/
- touched: wiki/index.md, wiki/overview.md, wiki/flows/buyer.md, wiki/sources/skill.md, wiki/sources/readme.md, wiki/commands/pay.md, wiki/commands/request.md, wiki/reference/hard-rules.md, wiki/reference/develop.md, wiki/reference/install.md
- notes: Agents load one `SKILL.md` (`zappi-agent-pot`). Auth-required `request` + “ask for `zpc_` only after a missing-token send” live in that file. TypeSafe `chosen_skill` is `zappi_agent_pot` | `zappi_eval_harness` | `none`. npm `files` ships `SKILL.md` only.

## [2026-09-24] ingest | SKILL-spend.md (zappi-agent-pot-spend)
- new: wiki/sources/skill-spend.md, wiki/commands/request.md
- touched: wiki/index.md, wiki/overview.md, wiki/usages.md, wiki/flows/buyer.md, wiki/sources/skill.md, wiki/sources/command-source.md, wiki/commands/pay.md, wiki/reference/hard-rules.md, wiki/reference/output.md, wiki/reference/environment.md, wiki/reference/develop.md, wiki/reference/install.md
- notes: New published skill `zappi-agent-pot-spend` is only `zappi-cli request` (create ticket → paste bare approve URL). Existing `zappi-agent-pot` stays setup + free `pay` / `consume`. TypeSafe `chosen_skill` includes `zappi_agent_pot_spend`. npm `files` now ships `SKILL-spend.md`.

## [2026-09-22] bootstrap | zappi-cli wiki
- new: wiki/index.md, wiki/overview.md, wiki/usages.md, wiki/log.md
- notes: No wiki existed under `packages/zappi-cli`. Schema follows the web LLM wiki (frontmatter, wikilinks, index, log) with CLI categories: sources, commands, reference, flows.

## [2026-09-22] ingest | README, SKILL, command source
- summary: wiki/sources/readme.md, wiki/sources/skill.md, wiki/sources/command-source.md
- touched: wiki/overview.md, wiki/usages.md, wiki/commands/propose.md, wiki/commands/pay.md, wiki/commands/consume.md, wiki/commands/invite.md, wiki/commands/wallet.md, wiki/commands/pots.md, wiki/reference/install.md, wiki/reference/environment.md, wiki/reference/auth.md, wiki/reference/output.md, wiki/reference/hard-rules.md, wiki/reference/develop.md, wiki/flows/buyer.md, wiki/index.md
- notes: README hard rule still says not to add `@zappimoney/zappi-sdk`; `package.json` 0.3.0 depends on it (`file:../zappi-sdk`) and wallet/pots commands call `ZappiClient`. Flagged on [[overview]] and [[sources/readme]]. `--json` for `pots attach` includes `potClientToken` when nest returns one; pretty output withholds it. Buyer fund step still does not call deposit APIs; developer `deposit-address` / `pots deposit-address` do.
