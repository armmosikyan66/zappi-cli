---
type: reference
tags: [cli, install]
updated: 2026-09-24
---

# Install

From [[sources/readme]]. Package `@zappimoney/zappi-cli`, bin `zappi-cli`. Node.js **≥ 20.9**. `prepare` / `prepack` run `tsc`. The bin is `bin/cli.js` running compiled `dist/` (no Node experimental flags).

**npm (recommended)**

```bash
npm install -g @zappimoney/zappi-cli
zappi-cli --help
```

**npx**

```bash
npx @zappimoney/zappi-cli --help
```

**GitHub global** (the line in [[sources/skill]])

```bash
npm i -g github:armmosikyan66/zappi-cli
zappi-cli --help
```

**Clone + link**

```bash
git clone https://github.com/armmosikyan66/zappi-cli.git
cd zappi-cli
npm install
npm link
zappi-cli --help
```

In this monorepo the package lives at `packages/zappi-cli` and depends on `@zappimoney/zappi-sdk` via `file:../zappi-sdk`. Published `files`: `bin`, `dist/**/*.js` except tests and `dist/eval/**`, `README.md`, `LICENSE`, `SKILL.md`.

Install has no `--pot` flag. See [[commands/propose]].
