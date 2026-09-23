---
type: reference
tags: [cli, auth]
updated: 2026-09-22
---

# Auth

Three different credentials. Do not treat the pot seed as an API key.

## Nest client (`src/client.ts`)

Used by [[commands/wallet]] and [[commands/pots]]. Precedence:

1. `ZAPPI_PROJECT_API_KEY` → `{ kind: 'projectKey' }`.
2. Else `ZAPPI_ACCESS_TOKEN` → `{ kind: 'session' }` plus optional `ZAPPI_COOKIE` and `ZAPPI_USER_AGENT`. The session object sends an empty `projectApiKey`; the user JWT is what nest sees.
3. Neither → throw: set a project key or an access token. The error states the pot seed is not a client credential.

The CLI does not invent credentials and does not ship a project key to a browser.

## Pot spend key (`src/load-pot-seed.ts`)

Used only to sign Spark USDB (pay, withdraw confirm, send internal/external).

1. `ZAPPI_POT_SEED` if set (reject `<…>` placeholders).
2. Else read `ZAPPI_POT_KEY_FILE`. The phrase is the last line that is not blank, not a `#` comment, and not a `key: value` line, with 12–24 words.
3. Else throw: set one of those two. Do not paste the key into chat.

Account number for CLI signs is `0`. Network is `SPARK_NETWORK`.

## Unlock bearer

Only [[commands/consume]] (and pay’s internal auto-consume, which uses the token nest just returned and does not print it). Env wins over `--unlock-token`.

## Step-up token

`--auth <token>` on `withdraw confirm`, `send internal`, `send external`, and `pots spend-approvals --approve` is an authorization token passed to nest. It is not the pot seed and not the unlock bearer.

`pay` and `invite` do not use the project key or access token. Invite sends no session.
