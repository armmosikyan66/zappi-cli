---
type: source
title: "@zappimoney/zappi-cli README"
author: zappi
date_published: 2026-09-22
date_ingested: 2026-09-22
source_path: packages/zappi-cli/README.md
tags: [cli, readme]
updated: 2026-09-24
---

# README

Ingest of `packages/zappi-cli/README.md`. Command lines that the source implements more precisely are on [[sources/command-source]] and [[usages]].

## Takeaways

- Buyer CLI for prepaid agent pots: propose a register deep link, pay a nest `PaidResource`, consume metered grants, or `request` an auth-required approve URL.
- Install paths: npm `@zappimoney/zappi-cli`, `npx`, `npm i -g github:armmosikyan66/zappi-cli`, or clone + `npm link`. Node ≥ 20.9. `prepare` compiles to `dist/`.
- Global `--json` never includes pot seeds or unlock tokens.
- `propose` is host setup. On a TTY with nothing set, the wizard asks existing vs generate, spend mode, network, app origin, and label (blank confirms auto `pot_<unique>`) before generate/register. Generating writes a mode `0600` key file and never prints the pot key.
- `pay` requires 402 `accepts[0].network` + `asset` to be `spark` / `USDB`. Settle body is `{ sparkTxHash, potId }`. Metered resources auto-consume one unit; `--no-consume` skips that.
- Auth-required: until `pots attach` is approved, `request` / `pay` / `consume` / `invite` fail closed. Never ask for a `zpc_` paste — pairing is URL + user code. `request` also reads `~/.zappi/pot-client-*.txt`.
- `invite` is `GET /api/invite/pots/$ZAPPI_POT_ID/link` with no session and no pot key. Fail closed (`INVITE_AFFILIATE_DISABLED`, `INVITE_LINK_MISSING`, or not attached on `auth_required`). Never invents a code.
- Wallet commands (`balance` through `send`, plus `pots …`) need `ZAPPI_PROJECT_API_KEY` or `ZAPPI_ACCESS_TOKEN`. Confirm and send sign from `ZAPPI_POT_SEED`.
- Buyer flow: propose on the host → human funds in the app (CLI does not call deposit APIs in that step) → pay → consume. Exact (`url_once`) resources stop after settle. Empty pot is the stop. Do not fall back to the main wallet.
- CI (`npm test`) is mocked HTTP + mocked Spark. `npm run test:pipeline` is optional TypeSafe and needs `TYPESAFE_API_KEY`. Staging dogfood pairs `ZAPPI_API_URL=https://api-dev.zappi.money` with `ZAPPI_APP_ORIGIN=http://dev.zappi.money`.
- Published npm files include `SKILL.md` (`zappi-agent-pot` — the only buyer skill).
- Active pot labels are unique per project (case-insensitive). Nest returns `409 AGENT_POT_LABEL_EXISTS`.

## Filed into

[[reference/install]], [[reference/environment]], [[reference/hard-rules]], [[reference/develop]], [[flows/buyer]], [[commands/propose]], [[commands/pay]], [[commands/request]], [[commands/consume]], [[commands/invite]], [[commands/wallet]], [[commands/pots]].

> ⚠️ The README hard rule says not to add `@zappimoney/zappi-sdk` unless migrating off Nest HTTP + Spark. `package.json` already depends on that SDK for the wallet surface. See [[overview]].
