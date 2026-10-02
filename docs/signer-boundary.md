# Free-pot signer boundary

> Linear: [1-456](https://linear.app/skribz/issue/1-456/securitycli-harden-free-pot-seed-registry-and-signing) ·
> Operator guide: [free-pot-registry-ops.md](./free-pot-registry-ops.md)

The free-pot signer holds an independent pot seed, decrypts it in memory,
and signs USDB spends. It is not the main wallet and it is not an
auth-required pot.

## 1. What this host stores

- Free-pot seeds live as ciphertext in `~/.zappi/pots.json` (mode 0600,
  directory 0700). The unlock secret is `ZAPPI_POT_PASSPHRASE`.
- A newly generated seed is sealed into a provisioning record before the
  command reports success. The Nest pot id is applied later with
  `pots registry bind`. Until then the record cannot be selected for signing.
- `--key-file` is an explicit plaintext opt-out. That file is the migration
  backup. The default path does not write it.
- The decrypted seed is a local variable. It is not exported to
  `process.env` and it is stripped from browser and clipboard child
  environments.

## 2. Identity

Signing uses one immutable context: pot id, Spark address, spend mode
`free`, network, derivation mode, and account index.

- Registry records are the identity for pots that have been sealed. The
  seed-derived address must match the stored address.
- A legacy `ZAPPI_POT_SEED` or `ZAPPI_POT_KEY_FILE` also requires
  `ZAPPI_POT_SPARK_ADDRESS`. A mismatch, `auth_required`, or an unknown
  spend mode fails before the seed is used.
- Import and restore keep the original network and account index. They do
  not substitute `SPARK_NETWORK` or account 0.

## 3. What this CLI does not enforce

- It does **not** detect a main-wallet mnemonic. Do not put a main-wallet
  seed in `ZAPPI_POT_SEED`, a key file, or `pots registry import`. Free-pot
  seeds are independent; the CLI cannot prove a phrase is not also a main
  wallet.
- It does **not** isolate the signer from the rest of the host account.
  Another process running as the same user can read the registry if it can
  read mode 0600 files owned by that user. Run the signer on a trusted host.
- `pots registry remove` deletes the local entry only. It does not revoke
  on-chain access and it does not guarantee memory or disk zeroization.
- Re-encryption and passphrase rotation do **not** invalidate old
  ciphertext or old backups. Those copies still decrypt with the old
  secret. Rotation does not revoke an exposed seed. A compromised seed
  needs a fresh pot and a separately human-authorized fund move.

## 4. Money-out

`pay`, Spark `send`, `send internal`, `send external`, and `withdraw confirm`
go through the verified context, the pre-sign gate, and the pending-operation
journal. The recipient address network must match the pot. `--idempotency-key`
is mixed into the journal key on those routes. The same intent and key
reconcile; a different key is a different payment.

An unreadable or oversized journal stops signing. The CLI does not reset
cap history to recover.

Auth-required pots, client tokens, and the request/approve flow are
unchanged and do not enter this signer.

## 5. Inherited settlement risk (release blocker)

[1-220](https://linear.app/skribz/issue/1-220/zappi-buyer-mcp-server-http-paywall-tools)
and [1-316](https://linear.app/skribz/issue/1-316/cli-typesafe-jev-pre-sign-gate-transfer-must-match-402)
remain an inherited payer-attribution / settlement-claim risk in the
backend settle path. Local registry and pre-sign checks do not close it.
See [free-pot-registry-ops.md](./free-pot-registry-ops.md) §10.

## 6. Windows

Not supported. Permission checks here are POSIX mode and uid. chmod is not
an ACL. Run the signer on macOS or Linux.
