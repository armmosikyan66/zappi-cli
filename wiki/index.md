---
type: index
tags: [meta, cli]
updated: 2026-09-24
source_count: 3
page_count: 21
last_change: 2026-09-24 Combined spend-ticket rules into SKILL.md; one published skill zappi-agent-pot.
---

# zappi-cli Wiki

LLM-maintained knowledge base for `@zappimoney/zappi-cli` (`zappi-cli`). The agent owns these pages. Read them, search them, and link to them. If something is wrong, ask the agent to fix it rather than editing by hand.

**How to use this wiki**

- Start at [[usages]] for every command line.
- Browse by category below.
- Every page has YAML frontmatter (`type`, `tags`, `updated`) and uses `[[wikilinks]]`.
- `log.md` is the chronological record of every ingest.
- Package version at ingest: **0.3.0**. Node.js **≥ 20.9**.

**Categories**

- `wiki/sources/` — one summary per ingested doc (`README.md`, `SKILL.md`, command source).
- `wiki/commands/` — behavior of each command group.
- `wiki/reference/` — install, environment, auth, output, hard rules, develop.
- `wiki/flows/` — end-to-end sequences.

---

## Sources

- [[sources/readme]] — package README: install, command table, env, staging, hard rules.
- [[sources/skill]] — agent skill `zappi-agent-pot` (the only published buyer skill): propose, pay, consume, auth-required `request`.
- [[sources/command-source]] — `src/` dispatch, help text, and per-command flags (source of truth when README lags).

## Overview

- [[overview]] — what the CLI is, two surfaces (buyer vs wallet), and what it will not do.

## Usages

- [[usages]] — every invocation, flag, and required env in one page.

## Commands

- [[commands/propose]] — host setup wizard and non-interactive register link.
- [[commands/pay]] — HTTP 402 → sign Spark USDB → settle; metered auto-consume.
- [[commands/request]] — auth-required spend ticket; stdout is one approve URL.
- [[commands/consume]] — further metered grant units with the unlock bearer.
- [[commands/invite]] — Nest invite URL for `ZAPPI_POT_ID`; fail closed.
- [[commands/wallet]] — balance, transactions, deposit, withdraw, send.
- [[commands/pots]] — list, register, deposit address, grants, spend gate, approvals, attach.

## Reference

- [[reference/install]] — npm, npx, GitHub, clone + link.
- [[reference/environment]] — every env var and how it resolves.
- [[reference/auth]] — project key vs access token vs pot seed.
- [[reference/output]] — pretty, plain, and `--json` contracts.
- [[reference/hard-rules]] — secrets, rails, invite codes, empty-pot cap.
- [[reference/develop]] — test, TypeSafe eval, build, publish files.

## Flows

- [[flows/buyer]] — propose → human fund → pay / request → consume, plus staging dogfood.
