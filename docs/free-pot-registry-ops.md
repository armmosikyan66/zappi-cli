# Free-pot seed registry — operator guide

> Linear: [1-456](https://linear.app/skribz/issue/1-456/securitycli-harden-free-pot-seed-registry-and-signing) ·
> [1-460](https://linear.app/skribz/issue/1-460/1-4564-provision-secrets-and-migrate-safely) ·
> Boundary: [docs/signer-boundary.md](./signer-boundary.md)

The encrypted free-pot seed registry (`~/.zappi/pots.json`) stores every
free-pot seed as ciphertext keyed by pot id. The CLI decrypts one seed into
memory per pot id, signs, and drops it. This guide covers provisioning,
migration, backup/recovery, rotation, removal, and compromised-seed response.

**Free pots only.** Auth-required pots, the pot client token, and the
request/approve flow are unchanged.

## 1. Trusted hosting

Run the signer on a trusted, dedicated host that only the bot that owns the
pot uses. Do not store the seed or the unlock secret on a shared computer
(e.g. a shared Grok box), and never send them into chat. See
[docs/signer-boundary.md](./signer-boundary.md).

## 2. Secret provisioning

The unlock secret is `ZAPPI_POT_PASSPHRASE` — a high-entropy host-managed
secret. It is **not** the human device-wallet passphrase; unattended free-pot
operation needs no human passphrase.

- Set `ZAPPI_POT_PASSPHRASE` in the bot's environment (secret file / secret
  manager), never in `~/.zshrc` or argv. It must be at least 16 characters.
  A missing, short, or placeholder (`<…>`) value fails before mnemonic
  generation.
- The generated mnemonic stays in signer memory and is sealed into an
  encrypted provisioning record before success. Nest has not assigned a pot
  id yet. After the human registers, bind that record:
  `zappi-cli pots registry bind --provision <prov_id> --pot-id <id>`.
- New pots are derivation mode `spark`, account index 1, network MAINNET. Import
  requires `--network MAINNET`, `--account-index 1`, and `--address`, and the
  CLI refuses to store a seed that does not reproduce that identity. The
  identity check and the write are one locked operation, so two different
  imports of the same pot cannot both succeed.
- `pots bind <potId>` seals once. Repeating it, or an attach that is rejected
  or interrupted, reuses that Spark address. It does not generate a replacement
  seed. Labels longer than 256 characters are rejected before the registry is
  written.
- The mnemonic is never written to `process.env`, stdout, stderr, logs, or
  HTTP debug output. Browser and clipboard children are spawned with host
  secrets removed from their environment.

## 3. Creating / importing a pot

```bash
# Unattended creation. Seals a provisioning record; does not write a txt file.
ZAPPI_POT_PASSPHRASE=<host-secret> zappi-cli propose --generate --mode free
# After Zappi shows the pot id:
zappi-cli pots registry bind --provision <prov_id> --pot-id <id>

# Explicit plaintext opt-out (warned). This is the only path that writes a key file.
ZAPPI_POT_PASSPHRASE=<host-secret> zappi-cli propose --generate --mode free --key-file ~/.zappi/pot.txt

# Import. Network, account index, and address are the original identity.
ZAPPI_POT_PASSPHRASE=<host-secret> zappi-cli pots registry import \
  --pot-id <id> --network MAINNET --account-index 1 --address <spark-address>
ZAPPI_POT_PASSPHRASE=<host-secret> zappi-cli pots registry import \
  --pot-id <id> --network MAINNET --account-index 1 --address <spark-address> \
  --from-file ~/.zappi/pot-research.txt
```

The mnemonic is **never** a CLI flag (it would leak to `ps` and shell
history). Import reads it from a hidden TTY prompt or a mode-0600 regular
file (symlinks, loose permissions, and oversized files are refused). The
source file is not deleted. An import that does not reproduce `--address`,
or that would replace a stored pot with a different network, account index,
or address, is refused and the existing entry is left as-is.

## 4. Legacy opt-out (plaintext key file / env seed)

Plaintext key files (`ZAPPI_POT_KEY_FILE`) and the env seed
(`ZAPPI_POT_SEED`) are **explicit legacy opt-outs / migration inputs**,
never automatic recovery from registry failure. If both a registry pot and
an env/file seed are set, the CLI fails closed — the registry is
authoritative.

A legacy seed is not treated as free just because it is set. Signing also
requires `ZAPPI_POT_SPARK_ADDRESS` (the pot's Spark address). The derived
address must match it. `ZAPPI_POT_SPEND_MODE=auth_required` and any unknown
spend mode are rejected before the seed is read. `ZAPPI_POT_ACCOUNT_INDEX`
overrides the default account 0 when set. Anyone who reads a plaintext file
gets the seed and can drain the pot. The CLI does not detect or refuse a
main-wallet mnemonic; do not import one.

## 5. Backup, restore, rotation

```bash
zappi-cli pots registry backup /mnt/backup/pots.json       # encrypted copy (ciphertext)
zappi-cli pots registry restore /mnt/backup/pots.json     # replace registry from backup
ZAPPI_POT_PASSPHRASE=<old> zappi-cli pots registry rotate-passphrase   # prompts for new (hidden, twice)
```

- **Backup** copies the encrypted registry through the same locking and
  permission checks as a normal write. The destination must not be a symlink.
  Store the copy on offline media. It stays decryptable with the passphrase
  that sealed it.
- **Restore** authenticates every envelope with `ZAPPI_POT_PASSPHRASE`,
  checks trusted API/app origins, and derives each seed at the stored
  network and account index. The derived address must match the stored
  Spark address. A corrupt backup, a wrong passphrase, tampered ciphertext,
  an authentic backup whose seed does not match that identity, or a symlink
  destination leaves the live registry untouched. The backup file is not
  modified. A stale backup restores the original pot identities (network,
  account index, address). It does not apply the current `SPARK_NETWORK` or
  account 0 as new defaults.
- Backup and restore share one size limit (1 MiB). A backup the writer
  accepted can be restored, including files larger than a 64 KiB phrase
  file. Phrase files (`--from-file`, `--key-file`) stay capped at 64 KiB.
  Anything over the registry limit is refused before the live file is replaced.
- **Rotation** re-seals every pot under a new passphrase, using the same
  locked atomic write. Retained old ciphertext and old backups **remain
  decryptable with the old secret**. Re-encryption does not revoke seed
  access and does not invalidate those copies.

## 6. `pots registry remove` — local access only

```bash
zappi-cli pots registry remove <potId>
```

This removes the pot's entry from the local registry. It does **not**:
- revoke on-chain access (the on-chain pot still exists and can be spent by
  anyone holding the seed), or
- guarantee memory/disk zeroization (best-effort only).

## 7. Compromised-seed response

If a seed was exposed (or the signer host was compromised), encryption and
CLI caps **cannot** prevent theft. The response is:

1. Create a **fresh, independent** free pot (`propose --generate`).
2. Migrate funds from the compromised pot to the new one, **authorized by a
   human** (do not automate money movement in this CLI).
3. Stop using the compromised pot and treat its seed as public.

Re-encrypting the registry or rotating the passphrase does not revoke an
exposed seed.

## 8. Windows

The encrypted registry is **not** supported on Windows yet. ACL-based
permission checks are required (chmod alone is insufficient). Run the
signer on macOS/Linux, or see [docs/signer-boundary.md](./signer-boundary.md) §6.

## 9. Money-out gates, caps, and the pending-operation journal

Every free-pot money-out path runs a deterministic pre-sign gate and a
durable pending-operation journal (Linear 1-461, extended by 1-468). That
includes `pay`, direct Spark `send`, `send internal`, `send external`, and
`withdraw confirm`. Auth-required pots never enter this signer.

Selectors: `--pot` and `--pot-id` are forwarded through `send internal`,
`send external`, direct Spark `send`, and `withdraw confirm`. If the flag
and `ZAPPI_POT_ID` name different pots, the command fails closed. It does
not sign the environment pot after dropping the flag. With no flag and no
`ZAPPI_POT_ID`, the registry's active pot is used.

- **Pre-sign gate**: the recipient Spark address is decoded and must be MAINNET,
  matching the verified pot. The integer cent amount,
  canonical USDB token (ticker USDB, 6 decimals, identifier network matching
  the pot), source account, and (for `pay`) the resource id are bound
  before signing. The first `btkn` balance entry is not assumed to be USDB.
  A quote whose account, token, amount, or expiry does not match is rejected.
  Quoted sends require a finite expiry. It is checked again immediately
  before broadcast, after token lookup. A missing or invalid expiry is
  refused. An already submitted transaction is reconciled even if that quote
  has since expired; the CLI does not sign a replacement for that reason.
- **Idempotency**: the journal key is the canonical intent plus the optional
  `--idempotency-key` salt. The same intent and salt reconcile (no second
  signature). A different salt is a different payment. `pay`, direct Spark
  send, internal send, and external send all pass that salt through.
  Omitting it does not mix in the current time, so a retry of the same
  command reconciles.
- **Journal failures fail closed.** Only a missing journal file starts empty.
  An oversized, unreadable, or corrupt journal stops signing and is not
  replaced. The CLI does not drop old operations to make room.
- **Durable journal** (`~/.zappi/pending-ops.json`, 0600, atomic write,
  cross-process lock): around every submission the gate records a pending op.
  On timeout, crash, or ambiguous settlement the same op is reconciled — a
  `submitted` op (tx hash known, settlement unconfirmed) is retried with that
  hash and **not** re-signed; a `pending` op with no tx hash (outcome unknown,
  including a signer that threw after broadcast was attempted)
  **fails closed**. A proven failure before broadcast (token lookup, expired
  quote, missing token) is marked `failed` and a later retry of that intent
  may sign. The CLI never issues a second payment for an intent whose
  broadcast outcome is unknown.
- **Caps** (defense in depth, not protection from raw-seed compromise):
  `ZAPPI_POT_MAX_PER_PAYMENT_CENTS` (per-payment) and
  `ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H` (trailing 24h) are enforced across
  all free-pot money-out paths, including concurrent attempts. Unset = disabled.

The backend's paywall-settlement replay recovery ([1-430](https://linear.app/skribz/issue/1-430/security-handle-paywall-settlement-replay-without-false-success-or),
[Nest PR 107](https://github.com/armmosikyan66/zappi-nest/pull/107)) is
reused, not duplicated: the CLI retries settle with the same tx hash and the
journal ensures it never re-signs on replay.

## 10. Inherited settlement risk (release blocker)

[1-220](https://linear.app/skribz/issue/1-220/zappi-buyer-mcp-server-http-paywall-tools)
and [1-316](https://linear.app/skribz/issue/1-316/cli-typesafe-jev-pre-sign-gate-transfer-must-match-402)
carry an inherited payer-proof / settlement-claim race: who is credited for a
Spark payment is decided by the backend settle path, not by this CLI's local
registry or pre-sign gate.

**Disposition:** explicit release blocker, not a newly confirmed exploit, and
not fixed by this work.

- The CLI gate checks recipient, amount, asset, network, source pot, and
  resource before signing, and the journal stops a second signature for the
  same intent.
- Those checks do **not** prove payer attribution. A local seed registry
  cannot decide which Zappi account an on-chain transfer belongs to.
- Backend remediation stays separately scoped. Do not treat 1-456 as closing
  1-220 or 1-316. Ship the free-pot signer only with that dependency recorded.

