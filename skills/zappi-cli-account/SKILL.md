---
name: zappi-cli-account
description: Sign this login in or out and read who it is. Use when whoami, login, logout, guest, or moving a guest pot onto an account is involved.
---

# Account

Commands: `zappi-cli whoami`, `zappi-cli login`, `zappi-cli logout`, `zappi-cli guest`, `zappi-cli guest claim --pot <id>`.

## whoami

Run `zappi-cli whoami` first. It prints the account email when this login exists. `signedIn: false` means this login is not signed in. Guest mode is reported from the guest file and the secret is not printed. A caller cannot name another account. If `whoami` already shows the account, do not run `login` again.

## login

`zappi-cli login` opens the Zappi sign-in screen and saves the session in `~/.zappi/credentials.json` (mode `0600`). There is no verification code. Do not mention a code. Do not ask the person to paste a token. The command does not print the session. Later commands on this login use that file. `ZAPPI_ACCESS_TOKEN` wins over the file when it is set.

## guest

`zappi-cli guest` starts a free pot without an account. It writes `~/.zappi/agent.json` (mode `0600`) and does not print the secret. Later commands on this login send that secret. Do not read the file into the chat.

`zappi-cli guest claim --pot <id>` needs `zappi-cli login` first. Pass the `potId` from `zappi-cli pots create`. The pot moves onto the account through the guest transfer. Tell the person their pot followed them. The server keeps signing that free pot. Do not create a second one.

The move is refused when it would put the account over its free-pot cap. The guest pot stays on the guest. Tell the person the account already has the maximum number of free pots, and to revoke one from a signed-in login before trying again.

A guest pot that was never signed in, and has not changed for 14 days, is revoked on the server. Do not tell the person the funds were deleted.

## logout

`zappi-cli logout` revokes the saved session and deletes the credentials file and the guest file. A later command has no login until `zappi-cli login` or `zappi-cli guest`.
