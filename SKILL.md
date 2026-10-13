---
name: zappi-cli-setup
description: Set up and attach a Zappi pot so a human can spend from it. Install zappi-cli. Never echo the pot key. Until an auth-required pot is attached, the bot can only run pots attach (pairing URL only — do not print the user code). Never ask for a zpc_ paste. For an app-created addressless free pot, run pots bind <potId> — the bot generates and stores the key as a host secret and prints only the pair URL. Spending on an agent host is approval tickets via the remote /mcp, not the CLI.
---

# Zappi CLI setup (attach a pot)

This is the **setup / attach** skill. Load `SKILL.md` (`zappi-cli-setup`) to propose or pair a pot. This skill does **not** spend. Spending on an agent host is approval tickets through the remote Streamable HTTP MCP at `https://api-dev.zappi.money/mcp` (`create_approval_ticket`, `pay`, `send`, `consume`): the agent creates a ticket, gives the human the approve URL, and stops. The human approves in the Zappi web app, where their session signs. The agent never holds or sends a pot seed, never signs, and never pastes `zpc_`. The local stdio MCP server (`@zappimoney/zappi-mcp`) and its OS keychain seed store are gone — do not call them.

## Connect vs send (read this first)

**Connecting** a pot (human pasted `npx @zappimoney/zappi-cli`, a pot id, “use this pot”, “connect”, or you loaded this skill):

- Set `ZAPPI_POT_ID` from the prompt. Do not invent a pot id.
- **Auth-required:** this pot is **not attached** until pairing is approved. The bot cannot request, pay, consume, invite, or claim it is ready to send. Run `zappi-cli pots attach --pot <potId> --spend-mode auth_required` with the pot id from the prompt (if `ZAPPI_POT_ID` is also set it must be the same pot). Paste the **pairing URL only**. Say they can open that link, or if it does not open, paste the verification code on the Zappi pairing page. Do not ask them to paste the code in chat. Do not print, store, or check a verification code. You do not receive one. They approve on that page. This host reclaims `zpc_` itself — **never** ask them to paste `zpc_`, seed, or session. Do not open Grok “Save securely”. After they approve, say attached and **stop**.
- **Free:** you already hold the key. Attach is not required. Reply that you are ready and **stop**. Do not run attach.

On connect you must **not**:

- open Grok “Save securely” / any paste field for `zpc_`
- ask for `ZAPPI_POT_CLIENT_TOKEN`, seed, recovery phrase, or session
- say a host secret is “still missing”
- run `request`, `pay`, `consume`, or `invite`

`zpc_` is **not** an account login. The human does not copy it from the pot page. Chat is not where they paste it.

**Sending** money is a later turn, and **only after this host is attached**. If they ask to send while not attached, refuse, run `pots attach`, paste the pairing URL only, and stop. If the link does not open, tell them to paste the verification code on the Zappi pairing page. Do not ask for that code in chat. On an agent host, spend is **not** a CLI command — it is an approval ticket through the remote `/mcp` (see *Spending on an agent host* below). Do not run `zappi-cli pay`, `send`, `consume`, or `request` as the agent spend path; those are for the human terminal (door 1).

Loading this skill is **not** a task. A pot id in the prompt is **not** a send.

Propose a pot (no global install):

```bash
npx @zappimoney/zappi-cli propose
```

`zappi-cli login` is optional and only when the human asks to sign **this**
terminal into their Zappi account. It opens the normal Zappi sign-in screen
(email or passkey). Do not run it for an agent host, and never print
`~/.zappi/credentials.json`.

The wizard asks whether the pot already exists or should be generated, how it
should spend (`free` or `auth_required`). Generating a key is only for `free`.
An approval-required pot is created in Zappi; this host never stores that key.
Spark is MAINNET (account index 1). `SPARK_NETWORK` unset is MAINNET; any other value is rejected. The wizard asks which app origin
to open (local, staging, production, or a custom URL — skipped when
`ZAPPI_APP_ORIGIN` or `NEXT_PUBLIC_SITE_URL` is set). A label you type is kept.
A blank label asks you to confirm auto `pot_<unique>` or a custom name. It then
opens the register link in your browser (ENTER to continue, `c` to copy). Do not
invent a pot id, seed, or invite code. Never print the pot key.

After the human registers and funds the pot, branch on spend mode.

## Free pot (you hold the key)

Setup is done — attach is not required, and you already hold the key on this terminal. Reply that you are ready and **stop**. Do not run attach.

**Spending** on an agent host is approval tickets via the remote `/mcp`, not `zappi-cli pay` / `consume`. The CLI spend commands (`pay`, `consume`) are for the human terminal (door 1) where the seed file lives — see *Spending on an agent host* below for the agent path. Do **not** invent a chain from an address: a pay reads the 402 `accepts[0].network` + `asset` and only pays `spark` / `USDB`.

## Pot-first free pot (app creates the pot, bot generates the key)

When the human made a **free** pot in the Zappi app *without* a key (addressless, `pending`) and pastes the `npx` one-liner with that `potId`:

```bash
npx @zappimoney/zappi-cli pots bind <potId>
```

This host generates the BIP-39 key, stores it as a **host secret** (`~/.zappi/pot-*.txt` / `ZAPPI_POT_SEED`), and pairs with the named pot through the device-code attach flow. Nest never sees the mnemonic. The human approves the pair link in Zappi; nest binds this host's `sparkAddress` onto the pot (`pending` → `active`).

- The command first calls the public `preview` to confirm the pot exists, is `free`, and is `pending` (addressless). It **fails closed** before generating a key if not.
- It prints **one pairing URL only** — never the mnemonic, never the user code, never `zpc_`. Pretty mode opens the browser and polls; `--no-poll` prints the request id + approve URL.
- After approval it reclaims `zpc_` itself. Then set `ZAPPI_POT_ID` and `ZAPPI_POT_SEED` (or `ZAPPI_POT_KEY_FILE`) as host secrets. Setup is complete — for spending on an agent host, use the remote `/mcp` (see *Spending on an agent host* below), not `zappi-cli pay` / `consume`.
- If this host already holds a pot client token, `pots bind` refuses — set `ZAPPI_POT_ID` and use the existing pot instead.

`pots bind` is the **only** command for the pot-first flow. Do not run `propose` (the pot already exists), do not run `pots attach` with a generated address, and do not ask the human for a seed or `zpc_`.

## Auth-required pot (human approves each spend)

You do **not** get the pot seed. Never ask for it. Do not run `pay`. Do not ask for `ZAPPI_ACCESS_TOKEN`, `zappi_access`, or a recovery phrase.

### Pair this host (when they paste the CLI + pot prompt)

```bash
zappi-cli pots attach --pot "<potId from Zappi UI>" --spend-mode auth_required
```

The pairing must name the pot. Without `--pot` (or `ZAPPI_POT_ID`) the command refuses; if both are set and differ, it refuses. It also refuses to print a link unless Zappi confirms that same pot. Stdout is one pairing URL. It includes this pot id and does **not** include a verification code. Paste that URL and tell them: open the link, or if it does not open, paste the verification code on the Zappi pairing page. Do not ask them to paste the code in chat. Do not print, store, or check a verification code. Do not print `deviceCode` or `zpc_`. Pretty mode withholds `zpc_`. They approve on that page — the page finds the pot. After they approve, this host stores the client token. Then wait. Do not run `request` until they ask to send **and** this host is attached.

If this host is already attached (`ZAPPI_POT_CLIENT_TOKEN` or `~/.zappi/pot-client-*.txt`), do **not** run `pots attach` again. If they ask for a new attach link, say this host is already attached and stop. Do not print a URL. The command itself refuses and does not create a link.

Until pairing is approved, the **only** allowed command is `pots attach`. `request` / `pay` / `consume` / `invite` fail closed with “not attached”. That means: run attach. Never ask them to paste `zpc_`. Never invent a token.

Wait until the human asks to **send money**. Do not ask for an amount or a destination until they do.

When they ask to send, you need both:

- **amount-cents** — positive integer (100 = $1)
- **to** — Spark destination (`spark1…` on mainnet)

If either is missing, ask for that one thing and **stop**. Do not invent them. Do not ask for `zpc_`.

On an agent host, spend is an approval ticket through the remote `/mcp` — see *Spending on an agent host* below. Do **not** run `zappi-cli request` (or `pay` / `send` / `consume`) as the agent spend path; those are for the human terminal (door 1). The remote `/mcp` `create_approval_ticket` (and `pay` / `send` / `consume`) returns one approve URL — paste that URL and stop. The human opens it in the Zappi web app, sees the amount and destination, and approves with a passkey; their session signs. The same ticket stays on the pot under **Spend to approve** if they never open the link. One ask, one ticket. Do not poll or sign.

If the pot is not attached, run `zappi-cli pots attach --spend-mode auth_required`. Do not open a paste field. Do not ask for `zpc_`.

If `request` fails because the pot is not attached, run `zappi-cli pots attach --pot <potId> --spend-mode auth_required`. Do not open a paste field. Do not ask for `zpc_`.

## Spending on an agent host (approval tickets)

This skill sets up and attaches a pot. It does **not** sign spends. On an agent host, spending is approval tickets through the remote Streamable HTTP MCP at `https://api-dev.zappi.money/mcp`:

1. The agent calls a spend tool on the remote `/mcp` — `create_approval_ticket`, or `pay` / `send` / `consume` (which now create a ticket instead of refusing).
2. The remote `/mcp` returns **one approve URL** and nothing else.
3. The agent pastes that URL to the human and **stops**. The human opens it in the Zappi web app, reviews amount and destination, and approves with a passkey. The human's web session signs the spend.
4. The agent never receives a seed, never signs, and never pastes `zpc_`. One ask, one ticket. Do not poll, do not sign, do not run a CLI spend command to "finish" it.

The CLI spend commands (`pay`, `consume`, `request`) still exist for the **human terminal** (door 1), where the seed file / `zpc_` live on the same machine. They are not the agent skill's spend path. The local stdio MCP server (`@zappimoney/zappi-mcp`) and its OS keychain seed store are removed — do not call them and do not look for a keychain seed.


## Fail closed — never bypass the CLI

When any `zappi-cli` command fails (apiUrl mismatch, not attached, network error, unknown command, etc.):

1. **STOP and report** the CLI error to the human.
2. Do **not** read `~/.zappi/pot-client-*`, `ZAPPI_POT_CLIENT_TOKEN`, device codes, or unlock tokens from disk.
3. Do **not** invent `fetch` / `curl` / Node scripts that call Nest with `zpc_` or `x-zappi-pot-client`.
4. Do **not** invent Nest routes. Pot ops go through the CLI only (or a documented curl example in this repo).

Auth-required pot balance uses the attach token **inside** the CLI:

```bash
zappi-cli balance --pot <potId>
# or ZAPPI_POT_ID set; uses x-zappi-pot-client against
# GET /api/wallet/pots/:potId/client/balance
```

Wallet-scope `balance` (no `--pot` / no pot id) still needs `zappi-cli login` or env session credentials. If login apiUrl mismatches the resolved API, run `zappi-cli login` again or `zappi-cli logout` — never bypass.

`zappi-cli doctor` prints saved login apiUrl vs resolved API (no secrets).

### Never ask for `zpc_`

Do not ask them to paste `zpc_` on connect, on send, or after a failed spend ticket. Pair with `pots attach` instead. This host reclaims the token after they approve. Do not mention a secret is missing after attach / “pot is set”.

`ZAPPI_POT_CLIENT_TOKEN` (`zpc_`) is a **host secret** used by the CLI attach/request path on the human terminal (door 1). Prefer env or `~/.zappi/pot-client-*.txt` already on this machine. **Never echo it.** On an agent host, spend goes through the remote `/mcp`, which does not use `zpc_` on the agent side.

**Do not** open a paste field, Grok “Save securely” box, or any save-secret prompt on:

- connect / first message / “use this pot”
- `npx @zappimoney/zappi-cli` / a pot id in the prompt
- loading this skill, “checking how the CLI is meant to be run”, or “we’re set for spends”
- propose, attach, pay, consume, invite, or a not-attached `request` failure

If they never paired this host: run `zappi-cli pots attach --pot <potId> --spend-mode auth_required`. They approve in the browser; this host reclaims the token. Chat is not where they copy `zpc_`. Do not invent one.

Never print or log `ZAPPI_POT_SEED`, `ZAPPI_POT_CLIENT_TOKEN`, or `ZAPPI_UNLOCK_TOKEN`. Leave `ZAPPI_API_URL` and `ZAPPI_APP_ORIGIN` unset so the CLI uses `https://api-dev.zappi.money` and every link is `https://dev.zappi.money`. Do not print `http://localhost:3000` unless the human asked for a local app and set `ZAPPI_APP_ORIGIN`. Approval-required pots do not get a key on this host. Do not run `propose --generate` for `auth_required`, and do not set `ZAPPI_POT_SEED`. Full docs: repository `README.md`.
