---
name: zappi-agent-pot
description: Spend a prepaid Zappi pot to unlock a PaidResource, or create an auth-required spend ticket and paste the approve URL. Install zappi-cli. Never echo the pot key. Until an auth-required pot is attached, the bot can only run pots attach (pairing URL + user code). Never ask for a zpc_ paste.
---

# Zappi agent pot (buyer)

This is the **only** buyer skill. Load `SKILL.md` (`zappi-agent-pot`). There is no second spend skill.

## Connect vs send (read this first)

**Connecting** a pot (human pasted `npx @zappimoney/zappi-cli`, a pot id, “use this pot”, “connect”, or you loaded this skill):

- Set `ZAPPI_POT_ID` from the prompt. Do not invent a pot id.
- **Auth-required:** this pot is **not attached** until pairing is approved. The bot cannot request, pay, consume, invite, or claim it is ready to send. Run `zappi-cli pots attach --spend-mode auth_required`. Paste the **pairing** URL and **user code**. They approve in Zappi. This host reclaims `zpc_` itself — **never** ask them to paste `zpc_`, seed, or session. Do not open Grok “Save securely”. After they approve, say attached and **stop**.
- **Free:** you already hold the key. Attach is not required. Reply that you are ready and **stop**. Do not run attach.

On connect you must **not**:

- open Grok “Save securely” / any paste field for `zpc_`
- ask for `ZAPPI_POT_CLIENT_TOKEN`, seed, recovery phrase, or session
- say a host secret is “still missing”
- run `request`, `pay`, `consume`, or `invite`

`zpc_` is **not** an account login. The human does not copy it from the pot page. Chat is not where they paste it.

**Sending** money is a later turn, and **only after this host is attached**. If they ask to send while not attached, refuse, run `pots attach`, paste pairing URL + user code, and stop. Do not run `request`.

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
should spend (`free` or `auth_required`), which Spark network matches the app
(MAINNET or REGTEST, skipped when `SPARK_NETWORK` is set), and which app origin
to open (local, staging, production, or a custom URL — skipped when
`ZAPPI_APP_ORIGIN` or `NEXT_PUBLIC_SITE_URL` is set). A label you type is kept.
A blank label asks you to confirm auto `pot_<unique>` or a custom name. It then
opens the register link in your browser (ENTER to continue, `c` to copy). Do not
invent a pot id, seed, or invite code. Never print the pot key.

After the human registers and funds the pot, branch on spend mode.

## Free pot (you hold the key)

```bash
export ZAPPI_POT_ID="<from Zappi UI>"
# ZAPPI_POT_SEED and ZAPPI_UNLOCK_TOKEN are host secrets — never chat / never log
zappi-cli pay <paidResourceId>
# metered: pay auto-consumes one unit; more units:
zappi-cli consume <paidResourceId>
```

Do **not** invent a chain from an address — `zappi-cli pay` reads 402 `accepts[0].network` + `asset` and only pays `spark` / `USDB`.

## Auth-required pot (human approves each spend)

You do **not** get the pot seed. Never ask for it. Do not run `pay`. Do not ask for `ZAPPI_ACCESS_TOKEN`, `zappi_access`, or a recovery phrase.

### Pair this host (when they paste the CLI + pot prompt)

```bash
export ZAPPI_POT_ID="<from Zappi UI>"
zappi-cli pots attach --spend-mode auth_required
```

Stdout includes `approveUrl` and `userCode`. Paste **those** (pairing still uses a code). Do not print `deviceCode` or `zpc_`. Pretty mode withholds `zpc_`. After they approve in Zappi, this host stores the client token. Then wait. Do not run `request` until they ask to send **and** this host is attached.

If attach is already approved on this host (`ZAPPI_POT_CLIENT_TOKEN` or `~/.zappi/pot-client-*.txt`), skip attach. Say attached and stop.

Until pairing is approved, the **only** allowed command is `pots attach`. `request` / `pay` / `consume` / `invite` fail closed with “not attached”. That means: run attach. Never ask them to paste `zpc_`. Never invent a token.

Wait until the human asks to **send money**. Do not ask for an amount or a destination until they do.

When they ask to send, you need both:

- **amount-cents** — positive integer (100 = $1)
- **to** — Spark destination (`spark1…` on mainnet)

If either is missing, ask for that one thing and **stop**. Do not invent them. Do not ask for `zpc_`.

```bash
export ZAPPI_POT_ID="<from Zappi UI>"
# ZAPPI_POT_CLIENT_TOKEN is a host secret — never chat / never log / never a flag
zappi-cli request --amount-cents <cents> --to <spark-address>
```

That command needs no TTY. Stdout is **one approve URL** and nothing else (`https://zappi.money/?panel=pots&spend=<id>`, no `code=`). Paste that URL. The human opens it, sees the amount and destination, and approves with a passkey. The same ticket stays on the pot under **Spend to approve** if they never open the link. `--json` includes the URL and never the `zpc_` token. Approving records the decision. It does not send the money. One ask, one ticket. Do not poll or sign.

If `request` fails because the pot is not attached, run `zappi-cli pots attach --spend-mode auth_required`. Do not open a paste field. Do not ask for `zpc_`.

### Never ask for `zpc_`

Do not ask them to paste `zpc_` on connect, on send, or after a failed `request`. Pair with `pots attach` instead. This host reclaims the token after they approve. Do not mention a secret is missing after attach / “pot is set”.

`ZAPPI_POT_CLIENT_TOKEN` (`zpc_`) is a **host secret** used only by `zappi-cli request`. Prefer env or `~/.zappi/pot-client-*.txt` already on this machine. **Never echo it.**

**Do not** open a paste field, Grok “Save securely” box, or any save-secret prompt on:

- connect / first message / “use this pot”
- `npx @zappimoney/zappi-cli` / a pot id in the prompt
- loading this skill, “checking how the CLI is meant to be run”, or “we’re set for spends”
- propose, attach, pay, consume, invite, or a not-attached `request` failure

If they never paired this host: run `zappi-cli pots attach`. They approve in the browser; this host reclaims the token. Chat is not where they copy `zpc_`. Do not invent one.

Never print or log `ZAPPI_POT_SEED`, `ZAPPI_POT_CLIENT_TOKEN`, or `ZAPPI_UNLOCK_TOKEN`. Staging: pair `ZAPPI_APP_ORIGIN=http://dev.zappi.money` with `ZAPPI_API_URL=https://api-dev.zappi.money`. Full docs: repository `README.md`.
