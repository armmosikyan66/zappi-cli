# @zappimoney/zappi-cli

Buyer CLI (`zappi-cli`) for prepaid Zappi agent pots. Propose a register deep link, pay a nest `PaidResource` (HTTP 402 → sign USDB from the pot → settle), then consume metered grant units.

## Install

**npm (recommended):**

```bash
npm install -g @zappimoney/zappi-cli
zappi-cli --help
```

**npx (no install):**

```bash
npx @zappimoney/zappi-cli --help
```

**From GitHub (global):**

```bash
npm i -g github:armmosikyan66/zappi-cli
zappi-cli --help
```

**Clone + link (local development):**

```bash
git clone https://github.com/armmosikyan66/zappi-cli.git
cd zappi-cli
npm install
npm link
zappi-cli --help
```

Requires **Node.js ≥ 20.9**. The package compiles TypeScript to `dist/` on install (`prepare`); the `zappi-cli` bin runs compiled JS via `bin/cli.js` (no experimental flags).

## Commands

Global flag: `--json` prints machine-readable JSON (never includes pot seeds or unlock tokens).

`propose` wizard asks **Auth not required** vs **Auth required** (sets deep-link `mode=free|auth_required`). Flags: `--mode free|auth_required`.


```bash
zappi-cli login                       # optional: sign this terminal into Zappi
zappi-cli propose                     # on the agent host (wizard)
zappi-cli pay <resourceId>            # agent, after the pot is funded
zappi-cli consume <resourceId> [--units N]
zappi-cli invite                      # Nest invite URL for this pot
```

| Command   | What it does                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login`   | **Optional, human.** Opens the Zappi sign-in screen (email or passkey). Saves a user session in `~/.zappi/credentials.json` (`0600`). Wallet commands use it when `ZAPPI_ACCESS_TOKEN` is unset. **Never prints the session.** Propose and pay do not need it. |
| `whoami`  | **Human.** Prints the email of the saved login. |
| `logout`  | **Human.** Revokes that session and deletes the credentials file. |
| `propose` | **Host setup** on the agent host. Wizard: existing or generate → how the pot should spend → label → **opens the register link**. Writes a mode `0600` key file when generating. **Never prints the pot key.** |
| `pay`     | **Agent spend** after fund. `GET` resource → 402 → `accepts[0].network` + `asset` must be `spark` / `USDB` → sign pot USDB → settle `{ sparkTxHash, potId }`. Other rails fail closed. Metered auto-consumes one unit (`--no-consume` to skip). |
| `consume` | **Agent spend.** `POST …/consume` with `X-Zappi-Unlock-Token` and `{ units }` (default `1`). |
| `invite`  | **Recommend Zappi.** `GET /api/invite/pots/$ZAPPI_POT_ID/link` (no session, no pot key). Prints the Nest invite URL. Fails closed if the flag is off or the pot has no code — it never invents one. |

### The `propose` wizard

```text
$ zappi-cli propose
Do you already have a pot, or should this host generate a new one?
◉ Generate a new pot (create a fresh key on this host)
○ Use an existing pot (I already registered one)
(↑/↓ to move, ENTER to select)
```

- Radio-circle menu: the selected row shows a **green ◉**, others a hollow `○`; **↑/↓ move**, ENTER confirms — *Generate a new pot* is the default. Digits (`1`/`2`) and `j`/`k` also work. (Set `NO_COLOR=1` to disable the green.)
- Existing pot → paste the public pot address from your agent (validated per network; blank cancels).
- Label question appears in both modes; a blank answer auto-generates `pot_<8-hex-id>`.
- Key file prompt: blank uses `~/.zappi/…txt`. If you paste a **folder** (e.g. `~/Documents/zappi/packages`), the CLI writes the `.txt` **inside** that folder instead of crashing with `EISDIR`.
- The browser step opens **`https://zappi.money`** by default (ENTER / auto-open / `c` to copy). Staging: `ZAPPI_APP_ORIGIN=http://dev.zappi.money` with `ZAPPI_API_URL=https://api-dev.zappi.money`. Ctrl+C quits cleanly.
- Bare `propose` without a terminal (no TTY) falls back to the flag usage instead of hanging.

### Wallet & pots commands

In addition to the agent-spend flow, the CLI mirrors the `@zappimoney/zappi-sdk` wallet surface so a developer can drive nest wallet routes from the terminal. Auth is `ZAPPI_PROJECT_API_KEY` (server-to-server), `ZAPPI_ACCESS_TOKEN` (one-off user JWT), or a session saved by `zappi-cli login`. Signing routes also use `ZAPPI_POT_SEED`.

`login` opens the same Zappi sign-in screen as the app: email code or passkey. The terminal never asks for a password and never shows a code to approve. The access token lasts about 15 minutes; the CLI refreshes it from the saved refresh token. Env `ZAPPI_ACCESS_TOKEN` still wins, so CI does not need a browser.

```bash
zappi-cli balance [--pot <id>]                 # wallet balance, or a pot balance with --pot
zappi-cli transactions [<id>]                   # ledger activity, or a receipt by id
zappi-cli deposit-options                       # deposit asset/network catalog
zappi-cli deposit-address --asset <a> --network <n>
zappi-cli withdraw-options
zappi-cli withdraw estimate  --asset <a> --network <n> --address <addr> --amount <cents>
zappi-cli withdraw quote     --asset <a> --network <n> --address <addr> --amount <cents>
zappi-cli withdraw confirm  <quoteId> [--auth <token>]
zappi-cli withdraw status   <id>
zappi-cli send internal --to <userId> --amount <cents> [--memo L] [--auth <token>]
zappi-cli send external --asset <a> --network <n> --address <addr> --amount <cents> [--auth <token>]

zappi-cli pots [--origin user|agent|unknown] [--spend-mode free|auth_required|unknown]
zappi-cli pots register <sparkAddress> [--label L] [--spend-mode free|auth_required]
zappi-cli pots deposit-address <id> [--source-chain base]
zappi-cli pots grants <id> [--create --scopes read,deposit] [--revoke <grantId>]
zappi-cli pots spend-gate <id> [--action withdraw|internal_send|sweep]
zappi-cli pots spend-approvals <id> [--create --action withdraw --amount 100 --destination 0x] [--approve <id>] [--reject <id>] [--auth <token>]
zappi-cli pots attach [--spend-mode free|auth_required] [--spark-address <addr>] [--no-poll]
zappi-cli pots attach-status <requestId>
```

`withdraw confirm` and `send internal`/`send external` sign Spark USDB from the host pot seed (`ZAPPI_POT_SEED`) via the two-phase orchestrator — the pot key never leaves the host; only the resulting `sparkTxHash` is sent to nest.

## Flow (propose → fund → pay → consume)

1. **Propose** — run on the **agent host**. The CLI generates the pot key there and opens a register URL. Human signs in to Zappi and taps Register.
2. **Fund** — human funds the pot in the Zappi app. The CLI does not call deposit APIs.
3. **Pay** — after `ZAPPI_POT_ID` + `ZAPPI_POT_SEED` (or key file) are set, pay a PaidResource. Nest returns an unlock bearer once on first settle. The CLI withholds that token from stdout/logs. Metered resources auto-consume one unit in the same `pay` (opt out with `--no-consume`).
4. **Consume** — further metered units: `zappi-cli consume <id>` with `ZAPPI_UNLOCK_TOKEN` set as a host secret.

Exact (`url_once`) resources stop after settle; use `unlockUrl` when nest returns it. Empty pot = stop. Do not fall back to the main wallet.

## Environment

| Variable             | Role                                                            |
| -------------------- | --------------------------------------------------------------- |
| `ZAPPI_POT_ID`       | Required for `pay` and `invite`. Public pot id from the Zappi prompt. |
| `ZAPPI_POT_SEED`     | Preferred pot spend key (host secret).                          |
| `ZAPPI_POT_KEY_FILE` | Fallback mode-`0600` key file if the seed env is unset.         |
| `ZAPPI_API_URL`      | Nest origin. **Production default:** `https://api.zappi.money`. |
| `ZAPPI_PAYWALL_BASE` | Optional paywall origin override (wins over `ZAPPI_API_URL`).   |
| `ZAPPI_UNLOCK_TOKEN` | Unlock bearer for `consume` (preferred over `--unlock-token`).  |
| `ZAPPI_POT_SPEND_MODE` | Runtime spend mode. `auth_required` refuses `pay` free-sign (approve in Zappi). Unset / `free` for agent-held pots. |
| `ZAPPI_APP_ORIGIN`   | Web origin for `propose` links. **Default `https://zappi.money`.** Staging: `http://dev.zappi.money`. |
| `SPARK_NETWORK`      | `MAINNET` (default) or `REGTEST`.                               |
| `ZAPPI_PROJECT_API_KEY` | Project API key for server-to-server wallet routes (`balance`, `pots`, `withdraw`, …). |
| `ZAPPI_ACCESS_TOKEN`    | User access JWT. Wins over `zappi-cli login`. |
| `ZAPPI_CREDENTIALS_FILE` | Override for the login file. Default `~/.zappi/credentials.json` (`0600`). |
| `ZAPPI_COOKIE`         | Optional cookie header forwarded for session auth (e.g. `zappi_access=…`). |
| `ZAPPI_USER_AGENT`     | Optional user-agent forwarded for session auth. |

`--unlock-token` exists for one-off calls. Scripts should use `ZAPPI_UNLOCK_TOKEN` so the bearer does not land in `ps` / shell history. Env wins when both are set.

## Staging dogfood

```bash
export ZAPPI_API_URL=https://api-dev.zappi.money
export ZAPPI_APP_ORIGIN=http://dev.zappi.money   # must pair with staging API
export ZAPPI_POT_ID='<pot id>'
# set ZAPPI_POT_SEED / ZAPPI_UNLOCK_TOKEN as host secrets — never echo / never commit

zappi-cli propose --generate --label Staging --open
# human registers + funds in the staging app
zappi-cli pay '<paidResourceId>'
# metered: pay already consumed one unit; more:
zappi-cli consume '<paidResourceId>' --units 1
```

Production paywall is the default (`https://api.zappi.money`).

## CI vs live dogfood

- **CI** (`npm test`): mocked HTTP + mocked Spark. Covers 402 → settle `{ sparkTxHash, potId }` → consume, empty pot fail-closed, **402 `network`/`asset` required** (refuse non-`spark`/`USDB` before sign), secret redaction (including BIP-39), `ZAPPI_POT_SPEND_MODE=auth_required` refusing CLI free-sign, and a **mocked TypeSafe judge** (copy honesty / skill / route). **No live Spark spend / no paywall network / no TypeSafe API.**
- **Optional TypeSafe pipeline** (`npm run test:pipeline`): agent-agent + human-ui fixtures, paraphrases, Pass^3 on copy. Requires `TYPESAFE_API_KEY` in `.env`. Not GitHub Actions.
- **Staging dogfood** (this section): human registers + funds in the app, then `pay` / `consume` against `api-dev`. Never commit seeds.
- `--json` is the CLI trace contract: `command`, `potId`, `sparkTxHash`, `network`, `asset`, `unlockTokenReceived` (boolean). It never includes the mnemonic, `ZAPPI_POT_SEED`, or `zpu_…` / `zpc_…` values.

Install has **no `--pot` flag**. Runtime pot id is `ZAPPI_POT_ID` after the human registers.

## Develop

```bash
npm install
npm test          # tsc → node --test dist/ (mocked HTTP + Spark + TypeSafe)
npm run test:judge  # live TypeSafe smoke
npm run test:pipeline  # agent-agent + human-ui + Pass^3 copy
npm run build
```

**Labels:** active pot names are unique per Zappi project (case-insensitive). Nest returns `409 AGENT_POT_LABEL_EXISTS` if the name is taken when you register in the app.

## Hard rules

- **Never** print, log, `echo`, or `set -x` `ZAPPI_POT_SEED`, the key file, or `ZAPPI_UNLOCK_TOKEN`.
- **Never** pass a recovery phrase as `--address` or put one in a deep link.
- Nest never holds the pot key. Cap v1 is an empty pot.
- Do **not** invent a payment chain from an address. Paywall 402 must include `accepts[0].network` and `accepts[0].asset`; this CLI only pays `spark` / `USDB`.
- Do **not** invent an invite code. `zappi-cli invite` prints a Nest URL or fails closed.
- Seller / project API is out of scope for this package.
- `@typesafe-ai/sdk` is a **devDependency** for `src/eval/` only. Do not import it from the buyer CLI. `dist/eval/` is not published. This is not `@zappimoney/zappi-sdk`.
- Do not add `@zappimoney/zappi-sdk` to this package unless intentionally migrating off the Nest HTTP + Spark path.
