---
type: overview
tags: [cli, pots]
updated: 2026-10-25
---

# Overview

`@zappimoney/zappi-cli` is the terminal for a Zappi pot (`zappi-cli`). Package version **0.3.10**. Bin is `zappi-cli` → `bin/cli.js` (compiled JS, no experimental flags). Requires Node.js **≥ 20.9**. The agent card is [[sources/skill]].

Three families share one binary (from [[sources/skill]], [[sources/readme]], and [[sources/command-source]]):

1. **This login** — `whoami`, `login`, `logout`, `guest`, `pots`, `deposit`, `pots send`. Session or guest file. Calls `/api/cli/*`. The server holds the pot. No spend mode and no per-pot limit. The signed Spark allowance is the only cap.
2. **Host key** — `propose`, `request`, `invite`. The pot key is created on this machine. A human registers and funds in the Zappi app. The CLI does not print the key. An auth-required pot prints one approve URL.
3. **Wallet** — `balance`, `transactions`, `deposit-options`, `deposit-address`, `withdraw`, `send`, and project-key `pots` (`attach`, `register`, `grants`, and the rest). Needs `ZAPPI_PROJECT_API_KEY` or `ZAPPI_ACCESS_TOKEN`.

`pay` and `consume` remain in the binary. They are the PaidResource paywall, which is after the MVP, and they are not part of the agent skill.

Help text groups host setup, the login door, and agent spend. Global flags: `--json`, `--help` / `-h`.

## What this package is not

- Seller / project API is out of scope (from [[sources/readme]]).
- This package is not the web app. Product install copy lives in the web wiki (`web/wiki/product/agent-pot-install.md`).
- A chat can still use the remote MCP server. This CLI does not speak MCP.

> ⚠️ Contradicts [[sources/readme]] hard rule “do not add `@zappimoney/zappi-sdk` unless intentionally migrating off the Nest HTTP + Spark path”: `package.json` already depends on `@zappimoney/zappi-sdk` (`file:../zappi-sdk`). Wallet and pots commands use `ZappiClient`. Buyer `pay` / `consume` still use the local Nest HTTP + Spark path in `src/paywall*.ts`, not the SDK client.

Full command lines: [[usages]]. Secrets and fail-closed rules: [[reference/hard-rules]].
