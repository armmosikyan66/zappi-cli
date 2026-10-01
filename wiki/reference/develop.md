---
type: reference
tags: [cli, test, develop]
updated: 2026-09-24
---

# Develop

```bash
npm install
npm test              # tsc, then node --test dist/ (mocked HTTP + Spark)
npm run build
```

## What CI covers

`npm test` does not hit live Spark or the paywall network. It covers 402 → settle `{ sparkTxHash, potId }` → consume, empty-pot fail-closed, 402 `network`/`asset` required (refuse non-`spark`/`USDB` before sign), secret redaction including BIP-39, `ZAPPI_POT_SPEND_MODE=auth_required` refusing CLI free-sign, and `request` printing a bare approve URL (no `code=`, no `zpc_`).

The TypeSafe judge is not part of this package. Agent-host spend controls live in `@zappimoney/zappi-mcp`.

## Package notes

- `"type": "module"`. TypeScript 5.8. Spark SDK `@buildonspark/spark-sdk`.
- Runtime dependencies include `@zappimoney/zappi-sdk` (`file:../zappi-sdk` in this repo). That contradicts the README line that says not to add the SDK; the wallet surface is the migration. Buyer pay still uses local HTTP. See [[overview]].
- `publishConfig.access` is `public`. Repository `https://github.com/armmosikyan66/zappi-cli`.
- Direct `node src/cli.ts` is not the supported bin. The published entry is compiled `bin/cli.js`.
