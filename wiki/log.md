---
type: log
tags: [meta]
updated: 2026-09-22
---

# Wiki Log

## [2026-09-22] bootstrap | zappi-cli wiki
- new: wiki/index.md, wiki/overview.md, wiki/usages.md, wiki/log.md
- notes: No wiki existed under `packages/zappi-cli`. Schema follows the web LLM wiki (frontmatter, wikilinks, index, log) with CLI categories: sources, commands, reference, flows.

## [2026-09-22] ingest | README, SKILL, command source
- summary: wiki/sources/readme.md, wiki/sources/skill.md, wiki/sources/command-source.md
- touched: wiki/overview.md, wiki/usages.md, wiki/commands/propose.md, wiki/commands/pay.md, wiki/commands/consume.md, wiki/commands/invite.md, wiki/commands/wallet.md, wiki/commands/pots.md, wiki/reference/install.md, wiki/reference/environment.md, wiki/reference/auth.md, wiki/reference/output.md, wiki/reference/hard-rules.md, wiki/reference/develop.md, wiki/flows/buyer.md, wiki/index.md
- notes: README hard rule still says not to add `@zappimoney/zappi-sdk`; `package.json` 0.3.0 depends on it (`file:../zappi-sdk`) and wallet/pots commands call `ZappiClient`. Flagged on [[overview]] and [[sources/readme]]. `--json` for `pots attach` includes `potClientToken` when nest returns one; pretty output withholds it. Buyer fund step still does not call deposit APIs; developer `deposit-address` / `pots deposit-address` do.
