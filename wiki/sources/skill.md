---
type: source
title: zappi-cli skill
author: zappi
date_published: 2026-09-22
date_ingested: 2026-10-25
source_path: packages/zappi-cli/SKILL.md
tags: [cli, skill, agents]
updated: 2026-10-25
---

# Agent skill

Ingest of `packages/zappi-cli/SKILL.md` (`name: zappi-cli`). The same file is `skills/zappi-cli/SKILL.md`. npm `files` ships both, plus the four door playbooks under `skills/`. Agents load this file to learn what the CLI is, which family a job uses, and the usage line. Full command lines are also [[usages]]. The combined pot skill, remote MCP plus this CLI, is hosted at the app origin `/pots/SKILL.md`. This file stays the CLI reference.

## Takeaways

- One binary, four families in this skill: this login (`/api/cli/*`), host key (`propose`, `request`, `invite`), local signer (`sign` and the `zappi-signer` commands), and wallet (`balance`, `send`, `withdraw`, project-key `pots`). `pay` and `consume` are the post-MVP paywall and are not in the skill.
- This login has no spend mode and no per-pot limit. The signed Spark allowance is the only cap. `pots create` sends `--label` and `--skip-name`. `--spend-mode` on create is accepted and not sent.
- Read one door playbook before that job: `zappi-cli-account`, `zappi-cli-pot`, `zappi-cli-deposit`, `zappi-cli-spend`. Leave the others closed. A Spark address is `sparkAddress` on `zappi-cli pots`. A balance is `zappi-cli pots balance`.
- `pots connect` connects this login. `pots attach` is device-code pairing. `pots send` is this login. `send` is the wallet. `request` prints an approve URL.
- Do not print a session, guest secret, pot seed, `zpc_`, device code, unlock token, or `ZAPPI_POT_PASSPHRASE`. On a failed command, stop. Do not read `~/.zappi/` secret files into chat.
