---
type: overview
tags: [cli, pots, paywall]
updated: 2026-09-22
---

# Overview

`@zappimoney/zappi-cli` is the buyer CLI (`zappi-cli`) for prepaid Zappi agent pots. Version **0.3.0**. Bin is `zappi-cli` → `bin/cli.js` (compiled JS, no experimental flags). Requires Node.js **≥ 20.9**.

Two surfaces share one binary (from [[sources/readme]] and [[sources/command-source]]):

1. **Buyer / agent spend** — `propose`, `pay`, `consume`, `invite`. The pot key is created on the agent host. A human registers and funds in the Zappi app. The agent later pays a nest `PaidResource` (HTTP 402 → sign USDB from the pot → settle) and consumes metered grant units.
2. **Wallet / pots (developer)** — `balance`, `transactions`, `deposit-options`, `deposit-address`, `withdraw-options`, `withdraw`, `send`, `pots`. These mirror `@zappimoney/zappi-sdk` nest routes. They need `ZAPPI_PROJECT_API_KEY` or `ZAPPI_ACCESS_TOKEN`. Signing routes also load `ZAPPI_POT_SEED` (or the key file). The pot key never leaves the host; only `sparkTxHash` is sent to nest.

Help text groups the same way: Host setup, Agent spend, Wallet, Pots. Global flags: `--json`, `--help` / `-h`.

## What this package is not

- Seller / project API is out of scope (from [[sources/readme]]).
- `@typesafe-ai/sdk` is a **devDependency** for `src/eval/` only. Do not import it from the buyer CLI. `dist/eval/` is not published.
- This package is not the web app. Product install copy lives in the web wiki (`web/wiki/product/agent-pot-install.md`).

> ⚠️ Contradicts [[sources/readme]] hard rule “do not add `@zappimoney/zappi-sdk` unless intentionally migrating off the Nest HTTP + Spark path”: `package.json` already depends on `@zappimoney/zappi-sdk` (`file:../zappi-sdk`). Wallet and pots commands use `ZappiClient`. Buyer `pay` / `consume` still use the local Nest HTTP + Spark path in `src/paywall*.ts`, not the SDK client.

Full command lines: [[usages]]. Secrets and fail-closed rules: [[reference/hard-rules]].
