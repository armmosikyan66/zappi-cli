# 1-658 — Pot spend modes (auth_required + free) implementation plan

> Linear: [1-658](https://linear.app/skribz/issue/1-658) (LaunchPad / MCP-Pot).
> Related: [1-635](https://linear.app/skribz/issue/1-635), [1-637](https://linear.app/skribz/issue/1-637) (remote `/mcp` ticket-only, In Review) · [1-456](https://linear.app/skribz/issue/1-456) / [1-454](https://linear.app/skribz/issue/1-454) (encrypted free-pot seed registry, In Review) · [1-460](https://linear.app/skribz/issue/1-460) (provision/migrate) · [1-461](https://linear.app/skribz/issue/1-461) / [1-557](https://linear.app/skribz/issue/1-557) (durable intent + idempotency) · [1-316](https://linear.app/skribz/issue/1-316) / [1-558](https://linear.app/skribz/issue/1-558) (pre-sign gate) · [1-559](https://linear.app/skribz/issue/1-559) (no silent downgrade) · [1-560](https://linear.app/skribz/issue/1-560) (credential-safe URLs) · [1-445](https://linear.app/skribz/issue/1-445) (no seed in chat / shared host) · [1-220](https://linear.app/skribz/issue/1-220) (inherited settlement risk, release blocker).

This is a **research + planning** artifact. No product code changes are made here. It records the current state of pot spend in this repo, recommends where the free-pot mnemonic lives, scopes the remaining auth-required finish/verify work and the free-mode implementation, and breaks the work into shippable subtasks.

## 0. Scope and repo access

- **Primary repo (this one, `armmosikyan66/zappi-cli`):** the buyer CLI that *signs* free-pot spends and *creates* auth-required spend tickets. Read in full.
- **`armmosikyan66/zappi-nest`** (Nest gateway, remote `/mcp` under `server/src/mcp`, pot spend/approval endpoints): **not accessible** — `git clone` returns `Repository not found` (private). The remote-MCP and Nest-side approval/settlement behavior in this plan is inferred from this CLI's contracts (`src/spend-request.ts`, `src/attach-commands.ts`, `src/client.ts`) and the wiki/SKILL docs. Anything that must be verified against Nest is flagged as an open question and assigned to a Nest-side subtask.
- **`edogbeatz/zappi`** (Next.js web: pot pages, attach/pairing, approval UI, MCP installer): **not accessible** — `git clone` returns `Repository not found` (private). The web approval UI is inferred from the approve-URL contract this CLI prints (`?panel=pots&spend=<id>`, no `code=`) and the SKILL. Web-side work is flagged and scoped at the contract level only.

Because two of three repos are private, several subtasks are written as cross-repo contracts (\"the CLI must call X; Nest must return Y\") with the implementation owner split called out. Subtasks that touch only this CLI are fully actionable from this repo.

## 1. Current state (this repo)

### 1.1 How spend mode is stored

- **Runtime mode** is an env var, `ZAPPI_POT_SPEND_MODE`, resolved in `src/env.ts`:
  - `resolvePotSpendMode()` (`src/env.ts:158`) → `'auth_required'` only for the exact string; **everything else (including unset) returns `'free'`**.
  - `assertFreeSignerSpendMode()` (`src/env.ts:296`) is the free-signer guard: unset/`free` passes; `auth_required` throws `AUTH_REQUIRED_PAY_ERROR`; any other value throws \"Unknown ZAPPI_POT_SPEND_MODE\".
- **Per-pot mode** is also stored as `PotMetadata.spendMode` inside the encrypted registry record (`src/pot-registry.ts:77`), but `validatePotRecord` (`src/pot-registry.ts:240`) **rejects anything but `'free'`** — the registry only ever holds free pots. Auth-required pots are never sealed here.
- The **authoritative** per-pot mode lives on Nest (the pot record). This CLI never reads Nest's stored mode at sign time; it trusts `ZAPPI_POT_SPEND_MODE` for the free signer and the attach token's presence for the auth-required path.

### 1.2 How auth_required spends flow today

`zappi-cli request` (`src/spend-request.ts`) — the only auth-required path in this CLI:

1. `requirePotId(env)` → `ZAPPI_POT_ID`.
2. `resolvePotClientToken(env)` (`src/env.ts:188`): `ZAPPI_POT_CLIENT_TOKEN` env (must start `zpc_`, placeholder-guarded) else `~/.zappi/pot-client-*.txt` from attach reclaim (`src/attach-device-secret.ts`). Missing → `POT_NOT_ATTACHED_ERROR` (fail closed). `requireAuthRequiredPotAttached()` (`src/env.ts:213`) gates `consume`/`request` on attach when mode is `auth_required`.
3. `POST /api/wallet/pots/:potId/spend-requests` with header `x-zappi-pot-client: <zpc_>` and body `{ amountCents, destinationAddress, destinationChain?, memo? }` (`src/spend-request.ts:140`).
4. Reads `id` from the 201 body; builds a **bare approve URL** `buildSpendApproveUrl()` → `<origin>/?panel=pots&spend=<id>`. `bareApproveUrl()` strips any `code=` param and rejects mnemonic-shaped ids.
5. `assertPrintableUrl()` refuses to print a URL containing `code=` or a `zpc_` token.
6. Output: pretty/plain print the URL alone; `--json` adds `approveUrl`, `requestId`, `amountCents`, `destinationAddress` — **never** the `zpc_` token.

The CLI **does not sign, does not poll, does not settle** for auth_required. Approval and on-chain settlement happen in Nest + web (inaccessible repos). The CLI's `pay`/`consume` refuse `auth_required` via `resolvePotSpendMode` + `AUTH_REQUIRED_PAY_ERROR` (`src/paywall.ts:177`).

### 1.3 What free-pot signing exists today (substantially built)

The free-pot signer is already implemented and merged (commits `fa96b13` 1-459, `3b0a292` 1-461, `1b75a3f` 1-462, `843ac04` 1-468, `5c70590` 1-482). Components:

- **Encrypted registry** `~/.zappi/pots.json` (`src/pot-registry.ts`): versioned envelope v1, PBKDF2-HMAC-SHA256 **600k** iterations → 32-byte key, 16-byte salt, AES-256-GCM with fresh 12-byte nonce + 16-byte tag, canonical AAD binds `potId/label/sparkAddress/spendMode/network/derivationMode/accountIndex/apiUrl/appOrigin/createdAt`, mode `0600`/dir `0700`, atomic crash-safe write (temp → fsync → rename → dir fsync), cross-process file lock + in-process mutex, POSIX-only (Windows refused). Bounded schema validation, prototype-pollution guards, symlink/owner/perm checks. Matches every 1-456 requirement listed in the issue.
- **Unlock secret** `ZAPPI_POT_PASSPHRASE` (`src/env.ts:268`): host secret, ≥16 chars, placeholder-guarded, never a CLI flag, never printed/logged.
- **Provisioning** (`src/pot-registry.ts:853` `saveProvisionedSeed`, `:897` `bindProvisionedSeed`): seal a freshly generated seed under a `prov_` id before Nest assigns a pot id; bind it onto the real pot id after the human registers. `propose --generate` uses this by default (`src/propose-register.ts:255`).
- **Verified context** `src/pot-context.ts` `resolvePotContext()`: resolves one immutable `PotContext` (potId, sparkAddress, `spendMode:'free'`, network, derivation, accountIndex, seed via `getSeed()`). Selector precedence `--pot > ZAPPI_POT_ID > registry activePotId`; seed source `registry > ZAPPI_POT_SEED > ZAPPI_POT_KEY_FILE`; **explicit contradictory selectors fail closed**; registry-present + env/file set is a conflict; **no silent fallback from registry to env/file**; seed-derived address must match stored address; rejects `auth_required`/unknown modes before reading any seed.
- **Pre-sign gate** `src/pot-outgate.ts` `validateMoneyOutIntent()`: binds recipient/amount/asset/network/source-pot/resource, USDB-only, deterministic `idempotencyKey` (SHA-256 of canonical intent + optional `--idempotency-key` salt). Quote-expiry enforcement for routed sends.
- **Durable journal** `src/pending-ops.ts` `~/.zappi/pending-ops.json`: `beginOperation` → `sign`/`reconcile`/`done`/`unknown`; `recordSubmitted`, `markSettled`, `markFailed`; **never re-signs** a `submitted`/`pending` op (fail closed on unknown broadcast outcome); per-payment + 24h cumulative caps (`ZAPPI_POT_MAX_PER_PAYMENT_CENTS`, `ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H`) enforced under the lock, including concurrent attempts.
- **Shared choke point** `src/free-pot-sign.ts` `gateAndSignFreePot()`: every money-out path resolves one context, gates recipient network, validates intent, journals, signs once.
- **Money-out paths** all routed through the gate + journal: `pay` (`src/paywall.ts`), direct Spark `send` (`src/send-commands.ts`), `send internal`/`send external`/`withdraw confirm` (`src/withdraw-commands.ts`). `--pot`/`--pot-id` carried through and fail closed on conflict with `ZAPPI_POT_ID`.
- **Legacy opt-out** `ZAPPI_POT_SEED` / `ZAPPI_POT_KEY_FILE` + `ZAPPI_POT_SPARK_ADDRESS` (`src/load-pot-seed.ts`, `src/pot-context.ts:155`): explicit, never automatic recovery from registry failure.
- **Operator commands** `src/pots-registry-commands.ts`: `list|use|remove|import|bind|rotate-passphrase|backup|restore`. Mnemonic never accepted from argv (masked TTY prompt or 0600 `--from-file`).

### 1.4 Where seeds currently live

| Location | What | Where | Notes |
| --- | --- | --- | --- |
| Encrypted registry | free-pot seeds as ciphertext | `~/.zappi/pots.json` (0600) | Primary. Unlocked by `ZAPPI_POT_PASSPHRASE`. |
| Unlock secret | passphrase | `ZAPPI_POT_PASSPHRASE` env | Host secret, ≥16 chars. **The one remaining secret in env.** |
| Legacy env seed | plaintext mnemonic | `ZAPPI_POT_SEED` env | Explicit opt-out. |
| Legacy key file | plaintext mnemonic | `ZAPPI_POT_KEY_FILE` (0600) | Explicit opt-out / migration input. |
| Provisioning record | sealed seed pre-pot-id | registry `provisions` map | Not selectable for signing until `bind`. |
| OS keychain | — | — | **Not used by this CLI.** The MCP server (`@zappimoney/zappi-mcp`, separate package) holds its key in the OS keychain per `SKILL.md`; this CLI does not. |
| Nest / remote | — | — | **Never.** CLI sends only `sparkTxHash` to Nest. |

### 1.5 What the remote MCP spend path does

This CLI is **not** the remote MCP. Per `SKILL.md`, `README.md`, and `wiki/overview.md`: agent-host spend is `@zappimoney/zappi-mcp` (and the `@zappimoney/zappi-cli-mcp` package per `wiki/log.md` 2026-10-06). This CLI is setup (`propose`, `pots attach`, `pots bind`) plus the developer wallet/pots surface. The remote `/mcp` endpoint and its ticket-only spend tools (1-635, 1-637) live in `zappi-nest` (inaccessible). From this CLI's side, the only \"remote spend\" contract is `request` creating a ticket — which is already ticket-only and never signs.

## 2. Recommendation: where the free-pot mnemonic lives

### 2.1 Options considered

1. **Encrypted file registry (current)** — PBKDF2 600k + AES-256-GCM, 0600/0700, atomic, cross-process lock, backup/restore/rotate. Portable, no daemon, works on a dedicated host. Cost: the unlock passphrase is a second secret that must be provisioned; same-uid processes can still read the decrypted file once unlocked in-process; not hardware-backed.
2. **OS keychain for the seed** (macOS Keychain, Linux `secret-service`/`kwallet`, Windows DPAPI) — OS-managed, can be hardware-backed (Secure Enclave/TPM), no passphrase in env. Cost: Linux `secret-service` needs an unlocked user session / daemon — **hostile to unattended bots**; not portable across hosts; the separate MCP package already owns the keychain path, so this CLI would duplicate it.
3. **Hardware / remote signer** (HSM, KMS, YubiHSM, remote signing service) — seed never on disk, strongest isolation. Cost: the Spark SDK (`@buildonspark/spark-sdk`) requires the mnemonic **in-process** to sign (`SparkWallet.initialize({ mnemonicOrSeed })` in `src/spark-send.ts:135`, `src/pot-context.ts:276`); a KMS cannot sign an arbitrary Spark USDB transfer today. Requires an SDK change or a custodial signing proxy — out of scope for 1-658.
4. **Env var for the seed** — rejected by the constraints (leaks to `ps`, child env, crash dumps, shared by every process on the host; 1-445).

### 2.2 Recommendation

**Keep the encrypted file registry as the primary seed store, and add an optional OS-keychain backend for the *unlock secret* (not the seed).** Concretely:

- The seed stays as ciphertext in `~/.zappi/pots.json` exactly as built in 1-456. No change to the envelope.
- `ZAPPI_POT_PASSPHRASE` remains the supported direct env source, but add `zappi-cli pots registry unlock-secret` (and a `--keychain` opt-in) that reads the passphrase from the OS keychain (macOS Keychain / Linux `secret-service` via a `keytar`-style binding) into memory for the process, so unattended hosts do not need the passphrase in `process.env` at all. The keychain stores **only the unlock secret**; the seed never enters the keychain.
- Provision the unlock secret once on the dedicated host (interactive `pots registry unlock-secret --set`, or `systemd` `LoadCredential`/cloud-secret injection). This closes the \"passphrase in env\" gap — the last secret reachable via `ps`/child env.
- Keep the documented hard requirement (already in `docs/signer-boundary.md` §1): the signer runs on a **dedicated, trusted host** for one bot. The registry cannot protect a seed from another same-uid process; that is an operational boundary, not a code one.

### 2.3 Tradeoffs

| | Encrypted file (current) | + keychain unlock secret | OS keychain for seed | Hardware/remote signer | Env var |
| --- | --- | --- | --- | --- | --- |
| Seed on disk (ciphertext) | yes | yes | no | no | yes (plaintext) |
| Secret in `ps`/env | passphrase | **none** | none | none | seed |
| Unattended-friendly | yes (needs env secret) | **yes** | no (Linux daemon unlock) | yes | yes |
| Portable across hosts | yes | no (keychain is per-host) | no | no | yes |
| Hardware-backed | no | optional (keychain HW) | yes | yes | no |
| Spark SDK compatible | yes | yes | n/a | **no (SDK needs mnemonic)** | yes |
| Backup/restore/rotate | yes (built) | yes (re-uses registry) | manual | n/a | n/a |

The keychain-unlock-secret layer is the highest-value, lowest-risk increment: it removes the last env secret without touching the envelope or the SDK signing path, and it degrades gracefully (fall back to `ZAPPI_POT_PASSPHRASE`) on hosts without a keychain. A future remote-signer migration is left open as a separate epic pending Spark SDK support.

## 3. Auth-required finish / verify work

The auth-required *ticket creation* path is implemented and tested in this CLI (`src/spend-request.ts`, `src/spend-request.test.ts`). What remains is **verification against the Nest + web contract** and closing the boundary gaps. Because Nest and web are inaccessible, these are scoped as cross-repo contracts plus this-CLI hardening.

### 3.1 Verify the ticket contract end-to-end (Nest + web)

- Confirm `POST /api/wallet/pots/:potId/spend-requests` (Nest) returns `{ id, approveUrl?, potClientToken? }` on 201 and that the CLI's `bareApproveUrl`/`assertPrintableUrl` assumptions hold against the real Nest response (the CLI strips `code=` and rejects `zpc_` in the URL today; verify Nest never returns a `code=`-bearing URL for an attached pot).
- Confirm the web approval UI at `?panel=pots&spend=<id>` (no `code=`) is sufficient to approve a ticket for an already-attached pot, and that approving records the decision without sending funds (per SKILL: "Approving records the decision. It does not send the money").
- Confirm Nest settlement after approval credits the pot and does not require this CLI to sign (the CLI never signs for auth_required). This is the part the owner has "partly tested … and it partly works" — pin the failing edge in a Nest-side subtask.

### 3.2 Close the silent-downgrade gap (1-559) in the legacy seed path

`assertFreeSignerSpendMode` rejects `auth_required` and unknown modes, but `resolvePotSpendMode` returns `'free'` for an **unset** `ZAPPI_POT_SPEND_MODE`. The registry path is safe (registry only holds free pots; `resolvePotContext` re-checks). The **legacy** path (`resolveLegacyContext`, `src/pot-context.ts:155`) trusts env mode alone: an auth_required pot with `ZAPPI_POT_SEED` + `ZAPPI_POT_SPARK_ADDRESS` set and `ZAPPI_POT_SPEND_MODE` **unset** would be treated as `free` and free-signed. That is a 1-559 silent downgrade. Fix: require an explicit positive signal that the pot is free before the legacy signer runs — either (a) require `ZAPPI_POT_SPEND_MODE=free` to be set explicitly for the legacy path, or (b) fetch the pot's authoritative mode from Nest (`GET /wallet/pots/:id` spend mode) and refuse to free-sign unless it is `free`. (b) is stronger but adds a Nest round-trip; (a) is local and matches the "explicit opt-out" framing already used for legacy seeds.

### 3.3 Credential-safe URLs (1-560) — extend to attach

`spend-request.ts` already strips `code=` and rejects `zpc_` in approve URLs. Verify the attach flow (`src/attach-commands.ts`, `src/invite-link.ts`) applies the same `relocateAppLink` + no-`code=` discipline to every URL printed for the human, and that no `deviceCode`/`zpc_` ever reaches stdout in pretty/plain mode (JSON uses boolean flags today per README). Add a redaction test if missing.

## 4. Free-mode implementation design

Most of the free-mode signer is built (§1.3). The remaining free-mode work is the **mnemonic-storage increment** from §2.2 and a few boundary tightenings, all in this CLI.

### 4.1 Keychain unlock-secret backend

- New module `src/pot-keychain.ts` (optional dependency, lazy-loaded so the CLI still installs/works on hosts without a keychain daemon). Operations: `getUnlockSecret(env)` → reads from keychain service `zappi-cli` account `pot-registry-unlock` (or env fallback); `setUnlockSecret(value)`; `deleteUnlockSecret()`.
- `resolvePotPassphrase` (`src/env.ts:268`) gains an optional keychain source: if `ZAPPI_POT_PASSPHRASE` is unset and `--keychain`/`ZAPPI_POT_USE_KEYCHAIN=1` is set, read the unlock secret from the keychain into a local variable (never `process.env`). Env still wins for back-compat.
- New command `zappi-cli pots registry unlock-secret [--set|--delete] [--keychain]`. `--set` prompts (masked) and stores; never prints the stored value. Falls back to `ZAPPI_POT_PASSPHRASE` when keychain unavailable with a clear "install keychain support" message.
- No change to the envelope, registry file format, or signing path. The seed still lives only as ciphertext in `~/.zappi/pots.json`.

### 4.2 Boundary tightenings (free mode)

- Apply the §3.2 fix to the legacy seed path so a free sign requires an explicit free signal.
- Add a test that an auth-required pot's record (if one were ever constructed) cannot pass `gateAndSignFreePot` (already covered in `free-pot-done-when.test.ts`; extend to the legacy path).
- Confirm `--pot`/`--pot-id` conflict-with-`ZAPPI_POT_ID` fail-closed is exercised on every money-out path (pay, send, send internal/external, withdraw confirm). Today `pay` and `send` check; verify the routed paths in `withdraw-commands.ts` do too.

### 4.3 Remote MCP / agent spend door (cross-repo, 1-635/1-637)

This CLI does not host `/mcp`. The remote-MCP ticket-only conversion is a Nest-side change (In Review). From this CLI, the only contract is that `request` continues to produce a bare approve URL and never signs — already true. The subtask here is **coordination + a contract test**: once Nest lands ticket-only `/mcp` spend tools, add a CLI-side test that asserts the `request` output URL shape matches what the remote MCP tool returns (so the two doors stay consistent). Local stdio MCP signer package removal (per the issue) is owned by the `@zappimoney/zappi-mcp` / `zappi-cli-mcp` package, not this repo — flagged as a dependency, not a subtask here.

## 5. Test matrix

`npm test` runs `tsc` then `node --test dist/*.test.js` with mocked HTTP + mocked Spark (no live funds, no network). The matrix below extends the existing suite.

### 5.1 Auth-required

| Case | Expected | Existing? |
| --- | --- | --- |
| `request` with `zpc_` env → 201 → bare approve URL, no `code=`, no `zpc_` in output | pass | `spend-request.test.ts` |
| `request` with no `zpc_` and no pot-client file | fail closed (`not attached`) | `spend-request.test.ts` |
| `request` `--json` includes `approveUrl`/`requestId`, never `zpc_`/`code=` | pass | `spend-request.test.ts` |
| `pay`/`consume` with `ZAPPI_POT_SPEND_MODE=auth_required` | refuse, point at `request` | `spend-request.test.ts`, `paywall.test.ts` |
| Nest 201 body with `code=` in `approveUrl` | CLI strips it / refuses to print | `spend-request.test.ts` (partial — add explicit) |
| Approve URL carries `zpc_` | CLI refuses to print | `spend-request.test.ts` |
| Attach URL redaction (no `deviceCode`/`zpc_` in pretty/plain) | pass | add if missing |
| Legacy seed path with auth_required pot + unset mode | **fail closed (new 1-559 fix)** | add |

### 5.2 Free

| Case | Expected | Existing? |
| --- | --- | --- |
| Registry pot: sign → settle → `markSettled` | pass | `paywall.test.ts`, `free-pot-done-when.test.ts` |
| Replay same intent → reconcile, no re-sign | pass | `pending-ops.test.ts`, `paywall.test.ts` |
| Crash after broadcast, no tx hash → fail closed | pass | `pending-ops.test.ts` |
| Pre-sign gate rejects wrong recipient/amount/asset/network/pot | pass | `pot-outgate` via `free-pot-sign` |
| Per-payment + 24h cumulative caps, concurrent | pass | `pending-ops.test.ts`, `free-pot-done-when.test.ts` |
| Registry + env/file seed both set → conflict fail closed | pass | `pot-context.test.ts` |
| Legacy seed address mismatch → fail closed | pass | `pot-context.test.ts` |
| `--pot` ≠ `ZAPPI_POT_ID` → fail closed on pay/send | pass | add for routed paths |
| Keychain unlock-secret read → sign without env passphrase | pass | **new** |
| Keychain unavailable → fall back to `ZAPPI_POT_PASSPHRASE` | pass | **new** |
| `unlock-secret --set` never prints stored value | pass | **new** |

### 5.3 Boundary

| Case | Expected | Existing? |
| --- | --- | --- |
| Auth-required context never reaches `gateAndSignFreePot` | pass | `free-pot-done-when.test.ts` |
| `auth_required` env + registry free pot → reject (mode mismatch) | pass | add |
| Unknown `ZAPPI_POT_SPEND_MODE` → reject before seed read | pass | `env.test.ts` |
| Secret redaction incl. BIP-39, passphrase, key/registry paths | pass | `free-pot-done-when.test.ts`, `paywall.test.ts` |
| No `child_process`/`spawn` in pay/send/registry/journal | pass | `free-pot-done-when.test.ts` |
| Windows refused (registry + journal) | pass | `pot-registry.test.ts`, `pending-ops.test.ts` |

## 6. Risks / open questions

1. **Inaccessible repos.** Nest (`zappi-nest`) and web (`edogbeatz/zappi`) are private; the auth-required settlement and remote `/mcp` ticket-only behavior cannot be verified from this repo. Subtasks 1 and 7 are contracts pending Nest/web access. **Mitigation:** owner grants access or confirms the contract on those repos.
2. **Inherited settlement risk (1-220/1-316) — release blocker.** `docs/signer-boundary.md` §5 and `docs/free-pot-registry-ops.md` §10 record that local registry + pre-sign gate do **not** prove payer attribution; backend settle path owns that. Not closed by 1-658. Ship free mode only with this dependency recorded.
3. **Silent downgrade in legacy seed path (1-559).** Real gap today (§3.2). Must be fixed before free mode is considered complete.
4. **Main-wallet mnemonic undetectable.** `docs/signer-boundary.md` §3: the CLI cannot prove a phrase is not also a main-wallet seed. Operational discipline only.
5. **Shared-host threat model.** The registry cannot protect a seed from another same-uid process. The "dedicated host" requirement is operational, not enforceable in code (1-445). The keychain unlock-secret layer reduces env exposure but does not change same-uid risk.
6. **Keychain on Linux unattended.** `secret-service` may require an unlocked user session. The design falls back to env passphrase; document that `systemd` `LoadCredential` or a headless secret store is the supported unattended path.
7. **Spark SDK in-process signing.** Blocks a true remote/HSM signer today. Out of scope; tracked as a future epic.
8. **`zappi-mcp` / `zappi-cli-mcp` ownership.** Local stdio signer removal and the OS-keychain spend path live in the MCP package, not this CLI. This plan's keychain work is the *registry unlock secret* only, deliberately non-overlapping.

## 7. Dependencies on Linear issues

- **1-635 / 1-637** (In Review, Nest): remote `/mcp` becomes the only agent door; spend tools ticket-only. This CLI's `request` already matches. Subtask 7 depends on these landing in Nest.
- **1-456 / 1-454 / 1-460** (In Review, this repo): encrypted free-pot seed registry + provisioning. Already landed here; subtasks 4–6 build on top.
- **1-461 / 1-557** (this repo): durable intent + idempotency journal. Already landed; subtask 6 reuses.
- **1-316 / 1-558** (this repo): pre-sign gate. Already landed (`pot-outgate.ts`); subtask 6 verifies coverage on routed paths.
- **1-559** (this repo): no silent auth_required→free downgrade. **Open gap** in the legacy seed path; subtask 3 closes it.
- **1-560** (this repo): credential-safe URLs. Mostly done for `request`; subtask 2 extends to attach.
- **1-445** (cross-repo): no seed in chat / shared host. Operational; reinforced by subtask 5 docs.
- **1-220** (Nest, release blocker): inherited settlement/payer-attribution risk. Not closed by 1-658; recorded as a ship dependency.

## SUBTASKS

### 1. Verify the auth-required ticket contract against Nest + web
Repos: `armmosikyan66/zappi-nest`, `edogbeatz/zappi` (both private; contract-verify), `armmosikyan66/zappi-cli` (test).
Plan section: §1.2, §3.1, §7.
Scope: Confirm `POST /api/wallet/pots/:id/spend-requests` returns `{ id, approveUrl?, potClientToken? }` on 201 with no `code=` in the URL for an attached pot; confirm the web `?panel=pots&spend=<id>` page approves and records the decision without sending funds; confirm Nest settles post-approval without this CLI signing. Pin the edge the owner has seen "partly work". Add a CLI-side contract test asserting the `request` output URL shape.
Acceptance:
- [ ] Nest spend-request 201 response shape documented and matched by `src/spend-request.test.ts` fixtures.
- [ ] Web approval page confirmed to approve (not send) for an attached pot; noted in plan.
- [ ] CLI test asserts `approveUrl` has no `code=` and no `zpc_` for the real Nest response.
- [ ] Any "partly works" edge reproduced and filed as a Nest issue.
Depends on: access to `zappi-nest` and `edogbeatz/zappi` (or owner confirmation of the contract).

### 2. Extend credential-safe URL redaction to attach/invite
Repos: `armmosikyan66/zappi-cli`.
Plan section: §3.3, §7 (1-560).
Scope: Audit `src/attach-commands.ts`, `src/invite-link.ts`, and any printed URL for `deviceCode`/`zpc_`/`code=` leakage in pretty/plain/JSON modes. Apply `relocateAppLink` + no-`code=` discipline uniformly. Add redaction tests where coverage is missing.
Acceptance:
- [ ] No attach/invite URL in pretty/plain output contains `deviceCode`, `zpc_`, or `code=`.
- [ ] `--json` uses boolean flags (`deviceCodeReceived`/`potClientTokenReceived`) and never raw secrets.
- [ ] New tests cover each printed URL shape; `npm test` green.
Depends on: none.

### 3. Close the silent-downgrade gap in the legacy free-seed path (1-559)
Repos: `armmosikyan66/zappi-cli`.
Plan section: §3.2, §4.2, §7 (1-559).
Scope: Make the legacy seed path (`resolveLegacyContext`) require an explicit positive free signal before signing — either require `ZAPPI_POT_SPEND_MODE=free` explicitly, or fetch the pot's authoritative mode from Nest and refuse unless `free`. Prefer the local explicit-mode option to avoid a new Nest round-trip and to match the existing "explicit opt-out" framing. Add boundary tests.
Acceptance:
- [ ] Legacy seed path with `ZAPPI_POT_SEED`/`ZAPPI_POT_KEY_FILE` + `ZAPPI_POT_SPARK_ADDRESS` and unset `ZAPPI_POT_SPEND_MODE` fails closed (does not free-sign).
- [ ] Explicit `ZAPPI_POT_SPEND_MODE=free` is required (or Nest mode fetched) for the legacy path to sign.
- [ ] Registry path behavior unchanged; existing registry tests green.
- [ ] New boundary tests added; `npm test` green.
Depends on: none.

### 4. Keychain unlock-secret backend (module + env resolution)
Repos: `armmosikyan66/zappi-cli`.
Plan section: §2.2, §4.1, §7 (1-445).
Scope: Add `src/pot-keychain.ts` (lazy-loaded optional dep) with `getUnlockSecret`/`setUnlockSecret`/`deleteUnlockSecret` for macOS Keychain and Linux `secret-service`. Extend `resolvePotPassphrase` to read the keychain when `ZAPPI_POT_PASSPHRASE` is unset and keychain opt-in is on; env still wins. The seed never enters the keychain; the envelope is unchanged. Degrade gracefully when no keychain daemon.
Acceptance:
- [ ] `src/pot-keychain.ts` reads the unlock secret from keychain into a local var (never `process.env`).
- [ ] `resolvePotPassphrase` prefers env, then keychain (when opted in), then throws.
- [ ] On hosts without a keychain, CLI still installs and `resolvePotPassphrase` falls back to env with a clear message.
- [ ] No new secret reaches stdout/stderr/logs; redaction tests extended.
- [ ] Unit tests with a mock keychain; `npm test` green.
Depends on: none.

### 5. `pots registry unlock-secret` command + operator docs
Repos: `armmosikyan66/zappi-cli`.
Plan section: §2.2, §4.1, §7 (1-445).
Scope: Add `zappi-cli pots registry unlock-secret [--set|--delete] [--keychain]` (masked prompt, never prints stored value), wire it to the module from subtask 4, and extend `docs/free-pot-registry-ops.md` and `docs/signer-boundary.md` with the keychain unlock-secret path, the `systemd LoadCredential`/headless-secret recommendation, and the unchanged "dedicated host" requirement. No envelope change.
Acceptance:
- [ ] `unlock-secret --set` stores via keychain (or env fallback) and prints only a boolean/confirmation.
- [ ] `unlock-secret --delete` removes the keychain entry; never prints the prior value.
- [ ] Operator docs cover provisioning, fallback, and the shared-host boundary.
- [ ] `--json` uses boolean flags only; `npm test` green.
Depends on: 4.

### 6. Verify free-mode money-out gate coverage on routed paths
Repos: `armmosikyan66/zappi-cli`.
Plan section: §4.2, §5.2, §7 (1-316/1-558/1-461/1-557).
Scope: Confirm `--pot`/`--pot-id` vs `ZAPPI_POT_ID` conflict fail-closed, the pre-sign gate, and the durable journal are exercised on every money-out path — pay, direct send, `send internal`, `send external`, `withdraw confirm`. Add tests for any routed path in `src/withdraw-commands.ts` that lacks explicit coverage. Reuse the existing `gateAndSignFreePot` choke point.
Acceptance:
- [ ] Each money-out path has a test asserting `--pot` ≠ `ZAPPI_POT_ID` fails closed.
- [ ] Each path has a replay/reconcile test (no re-sign) through the journal.
- [ ] Caps enforced on each path; `npm test` green.
Depends on: none (independent of 3–5).

### 7. Remote-MCP ticket-only contract test (1-635/1-637)
Repos: `armmosikyan66/zappi-cli` (test), `armmosikyan66/zappi-nest` (In Review, contract).
Plan section: §4.3, §7 (1-635/1-637).
Scope: Once Nest lands ticket-only `/mcp` spend tools, add a CLI-side contract test asserting the `request` output approve-URL shape matches the remote MCP tool's output (bare URL, no `code=`, no `zpc_`), so the two agent doors stay consistent. Coordinate the local stdio MCP signer removal with the `@zappimoney/zappi-mcp` / `zappi-cli-mcp` package owner (dependency, not implemented here).
Acceptance:
- [ ] CLI test asserts `request` URL shape equals the documented remote `/mcp` spend-tool output.
- [ ] Note in plan that stdio signer removal is owned by the MCP package, not this repo.
- [ ] `npm test` green.
Depends on: 1-635/1-637 landing in Nest; subtask 1 for the contract.

### 8. Free-mode release gate and 1-220 dependency record
Repos: `armmosikyan66/zappi-cli`.
Plan section: §5, §6, §7 (1-220).
Scope: Before declaring free mode done, run the full test matrix (§5), confirm subtasks 2–6 are green, and record the inherited 1-220/1-316 settlement-risk release blocker in the release notes / plan as a ship dependency (not closed by this work). Update `docs/signer-boundary.md` §5 cross-reference if needed.
Acceptance:
- [ ] Full §5 matrix green (auth-required, free, boundary).
- [ ] 1-220/1-316 release blocker explicitly recorded as an open dependency.
- [ ] No live funds, no network, no deployment used in verification.
Depends on: 2, 3, 4, 5, 6, 7.
