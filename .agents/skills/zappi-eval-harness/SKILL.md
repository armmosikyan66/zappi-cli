---
name: zappi-eval-harness
description: >-
  Pointer to the Zappi full-app hybrid eval harness for coding agents. Use when
  the user mentions llm-as-judge, TypeSafe judge, hybrid eval, full-app test,
  pot paywall eval, 1-227, 1-247, trajectory rubric, or multi-network /
  sourceChain / SPARK_NETWORK eval constraints. Not the buyer skill in this
  repo’s root SKILL.md.
---

# Zappi eval harness (CLI-repo pointer)

This workspace is **`zappi-cli`** (buyer CLI + tests). Canonical system map + full-app section catalog lives in the sibling web repo:

`../zappi/.agents/skills/zappi-eval-harness/SKILL.md`

Wiki hub: `../zappi/wiki/codebase/eval-harness.md` (Linear 1-247). Memo: `../zappi/wiki/analyses/llm-as-judge-pilot.md`.

Do **not** overwrite this package’s root `SKILL.md` (`zappi-agent-pot` buyer skill). Do not publish this folder to `.well-known/agent-skills`.

## Run

From **zappi** (named sections over both repos):

```bash
cd ../zappi
pnpm test:pipeline
pnpm test:pipeline -- --list
pnpm test:pipeline -- --section=paywall
```

From this CLI repo:

```bash
npm test
npm run test:pipeline   # live TypeSafe; TYPESAFE_API_KEY + TYPESAFE_JUDGE=1
```

That is `tsc` then `node --test dist/*.test.js dist/eval/*.test.js`. Mocked HTTP + mocked Spark + mocked TypeSafe. No live Spark.

Nest oracle (sibling, read-only unless Arman): `cd ../zappi-nest && npm run test:dogfood`.

## Do not fake

1-203 pairing secret vs public `approveUrl` · 1-231 attach deny + poll identity · 1-205 `zpc_` grant · 1-200 auth-required receipt · 1-232 two-owner factory · 1-228 standing deposit maps.

## Trace NEVER

mnemonic, `ZAPPI_POT_SEED`, `zpu_`, `zpc_`, JWT, project API key.

`ZAPPI_POT_ID` is runtime, not install. `ZAPPI_POT_SPEND_MODE=auth_required` refuses `pay`. `SPARK_NETWORK` defaults `MAINNET`. Paywall spend is `spark`/`USDB` only; do not guess `sourceChain`/`sourceAsset`. `@typesafe-ai/sdk` is a **devDependency** for `src/eval/` only. Never `@zappimoney/zappi-sdk`.
