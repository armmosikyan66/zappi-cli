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
  manager), never in `~/.zshrc` or argv.
- A missing or placeholder (`<…>`) passphrase fails before any pot creation or
  signing — the CLI never writes a plaintext seed.
- The generated mnemonic stays in signer memory and is sealed into the
  registry before success. It is never written to `process.env`, stdout,
  stderr, logs, or HTTP debug output, and never passed to child processes.

## 3. Creating / importing a pot

```bash
# Unattended creation (seals the generated seed into the registry):
ZAPPI_POT_PASSPHRASE=<host-secret> zappi-cli propose --generate --mode free

# Import an existing 12/24-word recovery phrase (masked TTY prompt, or a 0600 file):
ZAPPI_POT_PASSPHRASE=<host-secret> zappi-cli pots registry import --pot-id <id> [--label Research]
ZAPPI_POT_PASSPHRASE=<host-secret> zappi-cli pots registry import --pot-id <id> --from-file ~/.zappi/pot-research.txt
```

The mnemonic is **never** a CLI flag (it would leak to `ps` and shell
history). Import reads it from a hidden TTY prompt or a 0600 file.

## 4. Legacy opt-out (plaintext key file / env seed)

Plaintext key files (`ZAPPI_POT_KEY_FILE`) and the env seed
(`ZAPPI_POT_SEED`) are **explicit legacy opt-outs / migration inputs**,
never automatic recovery from registry failure. If both a registry pot and
an env/file seed are set, the CLI fails closed — the registry is
authoritative. Warn before relying on a plaintext file: anyone who reads that
file gets the seed and can drain the pot.

## 5. Backup, restore, rotation

```bash
zappi-cli pots registry backup /mnt/backup/pots.json       # encrypted copy (ciphertext)
zappi-cli pots registry restore /mnt/backup/pots.json     # replace registry from backup
ZAPPI_POT_PASSPHRASE=<old> zappi-cli pots registry rotate-passphrase   # prompts for new (hidden, twice)
```

- **Backup** is a copy of the already-encrypted registry (ciphertext). Store
  it on offline media. It is decryptable only with the passphrase.
- **Restore** validates the backup before overwriting the live registry, so
  a corrupt backup never destroys a working one. Identity is verified on
  first decrypt (the seed-derived Spark address must match each stored pot).
  A stale backup restores the original pot identities — that is the point.
- **Rotation** re-seals every pot under a new passphrase. It does **not**
  invalidate old ciphertext or old backups — they still decrypt with the old
  passphrase. Rotation does **not** revoke an exposed seed.

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
