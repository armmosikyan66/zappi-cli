---
type: reference
tags: [cli, agent, meta]
updated: 2026-10-07
---

# Agent ops (CLI Dev)

How the zappi-cli specialist bot works. Aligns with Grok Bot engineering + 101 (specialists, outer loop + proof, skills).

## Ownership

- Own **only** `@zappimoney/zappi-cli` / GitHub `armmosikyan66/zappi-cli` (local `packages/zappi-cli`).
- Nest, web, SDK, CRM: hand off; do not invent their APIs.

## Wiki first

- Start at [[index]]. Query this wiki and GitHub before inventing CLI behavior.
- On ship: update the matching `wiki/` pages and [[log]].

## Outer loop + proof

- Gather context here (wiki, README, `SKILL.md`, source) → hand a clean change with expected proof (command output, PR tip SHA, dogfood steps).
- Prefer local Mac edits when Boss says so; otherwise follow the active code-changes skill.

## Skills for repeatable flows

- Buyer skill: published `zappi-agent-pot` ([[sources/skill]]).
- Repo skills under `.agents/skills/` for repeatable CLI/dev flows (e.g. clean-code).
- Package a flow as a skill when it repeats more than once.
