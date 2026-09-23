---
type: reference
tags: [cli, env]
updated: 2026-09-22
---

# Environment

Resolvers live in `src/env.ts`. Defaults are production. Staging must set API and app origin **together**.

| Variable | Resolves to | Used by |
| --- | --- | --- |
| `ZAPPI_POT_ID` | Required string. Invite also requires a UUID. | [[commands/pay]], [[commands/invite]], and [[commands/wallet]] `balance` (pot scope when set). |
| `ZAPPI_POT_SEED` | Host spend key. Wins over the key file. `<placeholder>` rejected. | pay, withdraw confirm, send, any Spark sign. |
| `ZAPPI_POT_KEY_FILE` | Fallback file if the seed env is unset. Phrase is the last non-comment line with 12–24 words. | Same as the seed. |
| `ZAPPI_API_URL` | Nest origin. Default `https://api.zappi.money`. Staging `https://api-dev.zappi.money`. | Paywall base when `ZAPPI_PAYWALL_BASE` is unset. Also the SDK `apiUrl`. |
| `ZAPPI_PAYWALL_BASE` | Wins over `ZAPPI_API_URL` for the paywall/API origin. Trailing slashes stripped. | pay, consume, invite, wallet client. |
| `ZAPPI_APP_ORIGIN` | Web origin. Default `https://zappi.money`. Staging `http://dev.zappi.money`. | propose links, invite URL qualification. |
| `NEXT_PUBLIC_SITE_URL` | Fallback app origin when `ZAPPI_APP_ORIGIN` is unset. | propose, invite. |
| `ZAPPI_UNLOCK_TOKEN` | Unlock bearer. Wins over `--unlock-token`. | [[commands/consume]]. |
| `ZAPPI_POT_SPEND_MODE` | `auth_required` or anything else → `free`. | [[commands/pay]] refuses free-sign when `auth_required`. |
| `SPARK_NETWORK` | `REGTEST` if that exact word (case-insensitive); otherwise `MAINNET`. | Address checks, Spark sends. |
| `ZAPPI_PROJECT_API_KEY` | Project key. Wins over the access token. | Wallet and pots. |
| `ZAPPI_ACCESS_TOKEN` | User access JWT when no project key. | Wallet and pots. |
| `ZAPPI_COOKIE` | Optional cookie forwarded with session auth (example `zappi_access=…`). | Wallet and pots, session only. |
| `ZAPPI_USER_AGENT` | Optional user-agent forwarded with session auth. | Wallet and pots, session only. |
| `NO_COLOR` | `1` disables green in the propose menu. | [[commands/propose]] wizard. |
| `TYPESAFE_API_KEY` | Not a runtime CLI secret. Optional eval only. | [[reference/develop]]. |

`--origin` on propose overrides the app origin for that invocation. `--unlock-token` is the one-off consume flag; scripts should use the env var.
