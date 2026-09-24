---
type: reference
tags: [cli, test, develop]
updated: 2026-09-24
---

# Develop

```bash
npm install
npm test              # tsc, then node --test dist/ (mocked HTTP + Spark + TypeSafe)
npm run test:judge    # live TypeSafe smoke (TYPESAFE_JUDGE=1, .env)
npm run test:pipeline # agent-agent + human-ui + Pass^3 copy
npm run build
```

## What CI covers

`npm test` does not hit live Spark, the paywall network, or the TypeSafe API. It covers 402 → settle `{ sparkTxHash, potId }` → consume, empty-pot fail-closed, 402 `network`/`asset` required (refuse non-`spark`/`USDB` before sign), secret redaction including BIP-39, `ZAPPI_POT_SPEND_MODE=auth_required` refusing CLI free-sign, `request` printing a bare approve URL (no `code=`, no `zpc_`), and a mocked TypeSafe judge (copy honesty / skill / route). `chosen_skill` options: `zappi_agent_pot`, `zappi_eval_harness`, `none`. Fixture `agent-agent.skill.spend-auth-required` expects `zappi_agent_pot`.

`test:judge` and `test:pipeline` need `TYPESAFE_API_KEY` in `.env`. They are not GitHub Actions. Eval code is `src/eval/` and is excluded from the published tarball (`!dist/eval/**`).

## Package notes

- `"type": "module"`. TypeScript 5.8. Spark SDK `@buildonspark/spark-sdk`.
- Runtime dependencies include `@zappimoney/zappi-sdk` (`file:../zappi-sdk` in this repo). That contradicts the README line that says not to add the SDK; the wallet surface is the migration. Buyer pay still uses local HTTP. See [[overview]].
- `publishConfig.access` is `public`. Repository `https://github.com/armmosikyan66/zappi-cli`.
- Direct `node src/cli.ts` is not the supported bin. The published entry is compiled `bin/cli.js`.
