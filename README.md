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

Global flag: `--json` prints machine-readable JSON (never includes pot seeds, pot client tokens, or unlock tokens).

`propose` on a terminal asks before it generates or registers: existing vs new, spend mode, Spark network (unless `SPARK_NETWORK` is set), app origin (unless `ZAPPI_APP_ORIGIN` / `NEXT_PUBLIC_SITE_URL` / `--origin` is set), and a label. A blank label asks you to confirm auto `pot_<unique>` or type a custom name. Flags: `--mode free|auth_required`, `--origin`, `--label`.


```bash
zappi-cli login                       # optional: sign this terminal into Zappi
zappi-cli propose                     # on the agent host (wizard)
zappi-cli pay <resourceId>            # free pot: agent signs after the pot is funded
zappi-cli request --amount-cents 100 --to <spark-address>
zappi-cli consume <resourceId> [--units N]
zappi-cli invite                      # Nest invite URL for this pot
```

| Command   | What it does                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login`   | **Optional, human.** Opens the Zappi sign-in screen (email or passkey). Saves a user session in `~/.zappi/credentials.json` (`0600`). Wallet commands use it when `ZAPPI_ACCESS_TOKEN` is unset. **Never prints the session.** Propose and pay do not need it. |
| `whoami`  | **Human.** Prints the email of the saved login. |
| `logout`  | **Human.** Revokes that session and deletes the credentials file. |
| `propose` | **Host setup** on the agent host. Wizard: existing or generate → spend mode → network → app origin → label (blank confirms auto `pot_<unique>`) → **opens the register link**. Writes a mode `0600` key file when generating. **Never prints the pot key.** |
| `pay`     | **Free pot.** `GET` resource → 402 → `accepts[0].network` + `asset` must be `spark` / `USDB` → sign pot USDB → settle `{ sparkTxHash, potId }`. Other rails fail closed. Metered auto-consumes one unit (`--no-consume` to skip). `ZAPPI_POT_SPEND_MODE=auth_required` refuses this and points at `request`. |
| `request` | **Auth-required pot.** No TTY. `POST …/spend-requests` with `x-zappi-pot-client` and prints **only** the approve URL (`?panel=pots&spend=`, no `code=`). `--json` includes that URL and never the `zpc_` token. Does not sign. |
| `consume` | **Agent spend.** `POST …/consume` with `X-Zappi-Unlock-Token` and `{ units }` (default `1`). |
| `invite`  | **Recommend Zappi.** `GET /api/invite/pots/$ZAPPI_POT_ID/link` (no session, no pot key). Prints the Nest invite URL. Fails closed if the flag is off or the pot has no code — it never invents one. |

### The `propose` wizard

```bash
npx @zappimoney/zappi-cli propose
```

```text
Do you already have a pot, or should this host generate a new one?
◉ Generate a new pot (create a fresh key on this host)
○ Use an existing pot (I already registered one)
(↑/↓ to move, ENTER to select)
```

With no flags and no `SPARK_NETWORK` / app-origin env, the same run then asks spend mode, network, app origin, and label before it generates a key or opens the register link.

- Radio-circle menu: the selected row shows a **green ◉**, others a hollow `○`; **↑/↓ move**, ENTER confirms — *Generate a new pot* is the default. Digits (`1`/`2`) and `j`/`k` also work. (Set `NO_COLOR=1` to disable the green.)
- **Spend mode** — Auth not required (`free`) vs Auth required (`auth_required`).
- **Network** — MAINNET or REGTEST, only when `SPARK_NETWORK` is unset. It must match the app you register in. MAINNET is the first row. The CLI does not invent a network when that question is shown.
- **App origin** — production `https://zappi.money`, staging `http://dev.zappi.money` (pair with `https://api-dev.zappi.money`), local `http://localhost:3000`, or a custom http(s) URL. Asked only when `ZAPPI_APP_ORIGIN`, `NEXT_PUBLIC_SITE_URL`, and `--origin` are all unset. Production is the first row.
- Existing pot → paste the public pot address from your agent (validated for the network you chose; blank cancels).
- **Label** — both modes. A name you type is used as-is. A blank answer asks you to confirm **auto `pot_<8-hex>`** or enter a custom name. Auto, or a custom name left blank, accepts `pot_<unique>`.
- Key file prompt: blank uses `~/.zappi/…txt`. If you paste a **folder** (e.g. `~/Documents/zappi/packages`), the CLI writes the `.txt` **inside** that folder instead of crashing with `EISDIR`.
- The browser step opens the origin you chose (ENTER / auto-open / `c` to copy). Ctrl+C quits cleanly.
- Bare `propose` without a terminal (no TTY) prints flag usage instead of hanging.
- Flags (`--generate`, `--address`, `--mode`, `--origin`, `--label`, …) are for CI. When those flags plus `SPARK_NETWORK` fully specify the run, nothing is prompted. A non-TTY flag run keeps the previous defaults (`free`, MAINNET, `https://zappi.money`) and does not hang.

## Flow (propose → fund → pay or request → consume)

1. **Propose** — run on the **agent host**. The CLI generates the pot key there and opens a register URL. Human signs in to Zappi and taps Register.
2. **Fund** — human funds the pot in the Zappi app. The CLI does not call deposit APIs.
3. **Pay** (free pot) — after `ZAPPI_POT_ID` + `ZAPPI_POT_SEED` (or key file) are set, pay a PaidResource. Nest returns an unlock bearer once on first settle. The CLI withholds that token from stdout/logs. Metered resources auto-consume one unit in the same `pay` (opt out with `--no-consume`).
4. **Request** (auth-required pot) — `ZAPPI_POT_CLIENT_TOKEN` + `zappi-cli request` prints one approve URL. The human approves in Zappi. This command does not sign and does not ask for a session token.
5. **Consume** — further metered units on a free pot: `zappi-cli consume <id>` with `ZAPPI_UNLOCK_TOKEN` set as a host secret.

Exact (`url_once`) resources stop after settle; use `unlockUrl` when nest returns it. Empty pot = stop. Do not fall back to the main wallet.

## Environment

| Variable             | Role                                                            |
| -------------------- | --------------------------------------------------------------- |
| `ZAPPI_POT_ID`       | Required for `pay` and `request`. Public pot id from the Zappi prompt. |
| `ZAPPI_POT_CLIENT_TOKEN` | `zpc_` for `request` (host secret). Not a session token. Never a CLI flag. |
| `ZAPPI_ATTACH_DEVICE_CODE` | Attach reclaim secret (RFC 8628 device_code) from `pots attach` create (host secret). Wins over `~/.zappi/attach-device-<requestId>.txt`. **Never print.** |
| `ZAPPI_POT_SEED`     | Preferred pot spend key for free `pay` (host secret).           |
| `ZAPPI_POT_KEY_FILE` | Fallback mode-`0600` key file if the seed env is unset.         |
| `ZAPPI_API_URL`      | Nest origin. **Production default:** `https://api.zappi.money`. |
| `ZAPPI_PAYWALL_BASE` | Optional paywall origin override (wins over `ZAPPI_API_URL`).   |
| `ZAPPI_UNLOCK_TOKEN` | Unlock bearer for `consume` (preferred over `--unlock-token`).  |
| `ZAPPI_POT_SPEND_MODE` | Runtime spend mode. `auth_required` refuses `pay` and tells the agent to run `request`. Unset / `free` for agent-held pots. |
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
# set ZAPPI_POT_SEED / ZAPPI_POT_CLIENT_TOKEN / ZAPPI_UNLOCK_TOKEN as host secrets — never echo / never commit

npx @zappimoney/zappi-cli propose --generate --label Staging --mode free --origin http://dev.zappi.money
# SPARK_NETWORK unset on a terminal: the wizard still asks MAINNET vs REGTEST before generating
# human registers + funds in the staging app
zappi-cli pay '<paidResourceId>'
# metered: pay already consumed one unit; more:
zappi-cli consume '<paidResourceId>' --units 1
```

Production paywall is the default (`https://api.zappi.money`).

## CI vs live dogfood

- **CI** (`npm test`): mocked HTTP + mocked Spark. Covers 402 → settle `{ sparkTxHash, potId }` → consume, empty pot fail-closed, **402 `network`/`asset` required** (refuse non-`spark`/`USDB` before sign), secret redaction (including BIP-39), `ZAPPI_POT_SPEND_MODE=auth_required` refusing CLI free-sign, `request` printing a bare approve URL (no `code=`, no `zpc_`), and a **mocked TypeSafe judge** (copy honesty / skill / route). **No live Spark spend / no paywall network / no TypeSafe API.**
- **Optional TypeSafe pipeline** (`npm run test:pipeline`): agent-agent + human-ui fixtures, paraphrases, Pass^3 on copy. Requires `TYPESAFE_API_KEY` in `.env`. Not GitHub Actions.
- **Staging dogfood** (this section): human registers + funds in the app, then `pay` / `consume` against `api-dev`. Never commit seeds.
- `--json` is the CLI trace contract: `command`, `potId`, `sparkTxHash`, `network`, `asset`, `unlockTokenReceived` (boolean). `request --json` adds `approveUrl`, `requestId`, `amountCents`, and `destinationAddress`. `pots attach` / `attach-status` JSON uses `deviceCodeReceived` / `potClientTokenReceived` booleans — never raw `deviceCode` or `zpc_`. It never includes the mnemonic, `ZAPPI_POT_SEED`, or `zpu_…` / `zpc_…` values.

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


## Pot attach (device code / 1-203)

`zappi-cli pots attach` creates a pending pairing. Nest returns `deviceCode` **once** to the agent host and an `approveUrl` that carries only `requestId` + `userCode` for the human.

- **Host secret:** the CLI writes `deviceCode` to `~/.zappi/attach-device-<requestId>.txt` (mode `0600`). You can also set `ZAPPI_ATTACH_DEVICE_CODE` for reclaim. **Never echo / never commit.**
- **Human:** open/print `approveUrl` only.
- **Poll:** public `GET …/pots/attach/:requestId` is status-only (never `zpc_`).
- **Reclaim:** after `approved`, the CLI calls `POST …/pots/attach/:requestId/credentials` with header `X-Zappi-Device-Code` and stores `zpc_` under `~/.zappi/pot-client-<requestId>.txt` (`0600`). Set `ZAPPI_POT_CLIENT_TOKEN` from that file.
- **Output:** pretty/plain show `zpc_… (withheld)`. JSON uses `deviceCodeReceived` / `potClientTokenReceived` booleans — never raw secrets.
- `attach-status <requestId>` reclaims the same way when a device code is available from env or file.

Provisional reclaim path pending Nest tip confirmation.

## Hard rules

- **Never** print, log, `echo`, or `set -x` `ZAPPI_POT_SEED`, `ZAPPI_POT_CLIENT_TOKEN`, `ZAPPI_ATTACH_DEVICE_CODE`, the key file, attach-device / pot-client files under `~/.zappi/`, or `ZAPPI_UNLOCK_TOKEN`.
- **Never** ask for `ZAPPI_ACCESS_TOKEN`, `zappi_access`, the pot seed, or a recovery phrase to approve a spend. Paste the `request` URL.
- **Never** pass a recovery phrase as `--address` or put one in a deep link.
- Nest never holds the pot key. Cap v1 is an empty pot.
- Do **not** invent a payment chain from an address. Paywall 402 must include `accepts[0].network` and `accepts[0].asset`; this CLI only pays `spark` / `USDB`.
- Do **not** invent an invite code. `zappi-cli invite` prints a Nest URL or fails closed.
- Seller / project API is out of scope for this package.
- `@typesafe-ai/sdk` is a **devDependency** for `src/eval/` only. Do not import it from the buyer CLI. `dist/eval/` is not published. This is not `@zappimoney/zappi-sdk`.
- Do not add `@zappimoney/zappi-sdk` to this package unless intentionally migrating off the Nest HTTP + Spark path.
