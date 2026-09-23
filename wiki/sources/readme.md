---
type: source
title: "@zappimoney/zappi-cli README"
author: zappi
date_published: 2026-09-22
date_ingested: 2026-09-22
source_path: packages/zappi-cli/README.md
tags: [cli, readme]
updated: 2026-09-22
---

# README

Ingest of `packages/zappi-cli/README.md`. Command lines that the source implements more precisely are on [[sources/command-source]] and [[usages]].

## Takeaways

- Buyer CLI for prepaid agent pots: propose a register deep link, pay a nest `PaidResource`, consume metered grants.
- Install paths: npm `@zappimoney/zappi-cli`, `npx`, `npm i -g github:armmosikyan66/zappi-cli`, or clone + `npm link`. Node ≥ 20.9. `prepare` compiles to `dist/`.
- Global `--json` never includes pot seeds or unlock tokens.
- `propose` is host setup. Wizard chooses existing vs generate, spend mode (`free` | `auth_required`), label, then opens the register link. Generating writes a mode `0600` key file and never prints the pot key.
- `pay` requires 402 `accepts[0].network` + `asset` to be `spark` / `USDB`. Settle body is `{ sparkTxHash, potId }`. Metered resources auto-consume one unit; `--no-consume` skips that.
- `invite` is `GET /api/invite/pots/$ZAPPI_POT_ID/link` with no session and no pot key. Fail closed (`INVITE_AFFILIATE_DISABLED`, `INVITE_LINK_MISSING`). Never invents a code.
- Wallet commands (`balance` through `send`, plus `pots …`) need `ZAPPI_PROJECT_API_KEY` or `ZAPPI_ACCESS_TOKEN`. Confirm and send sign from `ZAPPI_POT_SEED`.
- Buyer flow: propose on the host → human funds in the app (CLI does not call deposit APIs in that step) → pay → consume. Exact (`url_once`) resources stop after settle. Empty pot is the stop. Do not fall back to the main wallet.
- CI (`npm test`) is mocked HTTP + mocked Spark. `npm run test:pipeline` is optional TypeSafe and needs `TYPESAFE_API_KEY`. Staging dogfood pairs `ZAPPI_API_URL=https://api-dev.zappi.money` with `ZAPPI_APP_ORIGIN=http://dev.zappi.money`.
- Active pot labels are unique per project (case-insensitive). Nest returns `409 AGENT_POT_LABEL_EXISTS`.

## Filed into

[[reference/install]], [[reference/environment]], [[reference/hard-rules]], [[reference/develop]], [[flows/buyer]], [[commands/propose]], [[commands/pay]], [[commands/consume]], [[commands/invite]], [[commands/wallet]], [[commands/pots]].

> ⚠️ The README hard rule says not to add `@zappimoney/zappi-sdk` unless migrating off Nest HTTP + Spark. `package.json` already depends on that SDK for the wallet surface. See [[overview]].
