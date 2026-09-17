# zappi-cli

Buyer CLI (`zappi-pot`) for prepaid Zappi agent pots. Propose a register deep link, pay a nest `PaidResource` (HTTP 402 → sign USDB from the pot → settle), then consume metered grant units.

## Install

**From GitHub (global):**

```bash
npm i -g github:armmosikyan66/zappi-cli
zappi-pot --help
```

**Clone + link (local development):**

```bash
git clone https://github.com/armmosikyan66/zappi-cli.git
cd zappi-cli
npm install
npm link
zappi-pot --help
```

Requires **Node.js ≥ 20.9**. The package compiles TypeScript to `dist/` on install (`prepare`); the `zappi-pot` bin runs compiled JS (no experimental flags).

## Commands

```bash
zappi-pot propose --generate --label Research --open
zappi-pot pay <resourceId>
zappi-pot consume <resourceId> [--units N]
```

| Command   | What it does                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propose` | Generate or accept a public `spark1…` address and print the P0 register deep link. Writes a mode `0600` key file on `--generate`. **Never prints the mnemonic.**                                                                                          |
| `pay`     | `GET` resource → 402 → sign pot USDB to `payTo` → `POST …/settle` with `{ sparkTxHash, potId }`. If `pricingMode` is `metered` (or `unlockMode` is `metered_grant`), **auto-consumes one unit** after a first-unlock settle. Pass `--no-consume` to skip. |
| `consume` | `POST …/consume` with `X-Zappi-Unlock-Token` and `{ units }` (default `1`).                                                                                                                                                                               |

## Flow (propose → fund → pay → consume)

1. **Propose** — agent generates the pot key on the host and prints a register URL. Human opens it in Zappi and taps Register.
2. **Fund** — human funds the pot in the Zappi app. The CLI does not call deposit APIs.
3. **Pay** — after `ZAPPI_POT_ID` + `ZAPPI_POT_SEED` (or key file) are set, pay a PaidResource. Nest returns an unlock bearer once on first settle. The CLI withholds that token from stdout/logs. Metered resources auto-consume one unit in the same `pay` (opt out with `--no-consume`).
4. **Consume** — further metered units: `zappi-pot consume <id>` with `ZAPPI_UNLOCK_TOKEN` set as a host secret.

Exact (`url_once`) resources stop after settle; use `unlockUrl` when nest returns it. Empty pot = stop. Do not fall back to the main wallet.

## Environment

| Variable             | Role                                                            |
| -------------------- | --------------------------------------------------------------- |
| `ZAPPI_POT_ID`       | Required for `pay`. Public pot id from the Zappi prompt.        |
| `ZAPPI_POT_SEED`     | Preferred pot spend key (host secret).                          |
| `ZAPPI_POT_KEY_FILE` | Fallback mode-`0600` key file if the seed env is unset.         |
| `ZAPPI_API_URL`      | Nest origin. **Production default:** `https://api.zappi.money`. |
| `ZAPPI_PAYWALL_BASE` | Optional paywall origin override (wins over `ZAPPI_API_URL`).   |
| `ZAPPI_UNLOCK_TOKEN` | Unlock bearer for `consume` (preferred over `--unlock-token`).  |
| `ZAPPI_APP_ORIGIN`   | Web origin for `propose` links. Default `https://zappi.money`.  |
| `SPARK_NETWORK`      | `MAINNET` (default) or `REGTEST`.                               |

`--unlock-token` exists for one-off calls. Scripts should use `ZAPPI_UNLOCK_TOKEN` so the bearer does not land in `ps` / shell history. Env wins when both are set.

## Staging dogfood

```bash
export ZAPPI_API_URL=https://api-dev.zappi.money
export ZAPPI_APP_ORIGIN=https://dev.zappi.money   # if that web origin is what you use
export ZAPPI_POT_ID='<pot id>'
# set ZAPPI_POT_SEED / ZAPPI_UNLOCK_TOKEN as host secrets — never echo / never commit

zappi-pot propose --generate --label Staging --open
# human registers + funds in the staging app
zappi-pot pay '<paidResourceId>'
# metered: pay already consumed one unit; more:
zappi-pot consume '<paidResourceId>' --units 1
```

Production paywall is the default (`https://api.zappi.money`). CI runs build + unit tests only — **no live Spark spend / no paywall network**.

## Develop

```bash
npm install
npm test          # tsc → node --test dist/
npm run build
```

## Hard rules

- **Never** print, log, `echo`, or `set -x` `ZAPPI_POT_SEED`, the key file, or `ZAPPI_UNLOCK_TOKEN`.
- **Never** pass a recovery phrase as `--address` or put one in a deep link.
- Nest never holds the pot key. Cap v1 is an empty pot.
- Seller / project API is out of scope for this package.
- Do not add `@zappimoney/zappi-sdk` to this package unless intentionally migrating off the Nest HTTP + Spark path.
