/**
 * Free-pot seed registry operator commands — Linear 1-456 stage 4 / 1-460.
 *
 * `zappi-cli pots registry <list|use|remove|import|rotate-passphrase|backup|restore>`.
 *
 * Secret hygiene: the mnemonic/passphrase is never accepted from argv (would
 * leak to `ps`/shell history). Import reads it from a masked TTY prompt or a
 * 0600 `--from-file` migration input. The seed is never written to `process.env`,
 * stdout, stderr, logs, or HTTP debug. `pots registry remove` is local access
 * removal only — it does NOT revoke on-chain access and does NOT guarantee
 * memory/disk zeroization. See docs/free-pot-registry-ops.md.
 */

import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  listPots,
  removePot,
  setActivePot,
  savePotSeed,
  getActivePot,
  validateRegistryFile,
} from './pot-registry.js'
import {
  resolvePotPassphrase,
  resolveSparkNetwork,
  potRegistryPath,
  type PotEnv,
} from './env.js'
import { askSecret } from './wizard-io.js'
import { extractPhraseFromKeyFile } from './load-pot-seed.js'
import { looksLikeMnemonicPhrase } from './spark-address.js'
import {
  heading,
  infoLine,
  kv,
  successLine,
  warnLine,
  errorLine,
  type OutputMode,
} from './ui.js'

const NL = '\n'

export interface PotsRegistryCommandDeps {
  env?: PotEnv
  askSecret?: (prompt: string) => Promise<string>
  /** Override Spark address derivation (tests). Default uses the Spark SDK. */
  deriveAddress?: (seed: string, network: 'MAINNET' | 'REGTEST', accountIndex: number) => Promise<string>
  now?: () => Date
}

function jsonOut(result: unknown): string {
  return JSON.stringify(result, null, 2)
}

function depsEnv(deps?: PotsRegistryCommandDeps): PotEnv {
  return deps?.env ?? process.env
}

/** `pots registry list` — never includes the seed or envelope material. */
export async function runPotsRegistryList(
  mode: OutputMode,
  deps: PotsRegistryCommandDeps = {},
): Promise<string> {
  const env = depsEnv(deps)
  const pots = await listPots({ env })
  const active = await getActivePot({ env })
  const result = { ok: true as const, command: 'pots registry list' as const, activePotId: active ?? null, pots }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    if (pots.length === 0) return 'No pots in registry.'
    return pots.map((p) => `${p.potId} ${p.sparkAddress} ${p.network}`).join(NL)
  }
  if (pots.length === 0) return infoLine('No pots in the encrypted registry.', mode)
  const lines = [heading('Free-pot registry', mode)]
  if (active) lines.push(kv('active', active, mode))
  for (const p of pots) {
    const marker = p.potId === active ? '* ' : '  '
    lines.push(`${marker}${successLine(p.potId, mode)} ${kv('address', p.sparkAddress, mode)} ${kv('net', p.network, mode)}${p.label ? ` ${kv('label', p.label, mode)}` : ''}`)
  }
  return lines.join(NL)
}

/** `pots registry use <potId>` — set the active pot. */
export async function runPotsRegistryUse(
  argv: string[],
  mode: OutputMode,
  deps: PotsRegistryCommandDeps = {},
): Promise<string> {
  const potId = argv.find((a) => !a.startsWith('-'))?.trim()
  if (!potId) throw new Error('Usage: zappi-cli pots registry use <potId>')
  await setActivePot(potId, { env: depsEnv(deps) })
  const result = { ok: true as const, command: 'pots registry use' as const, activePotId: potId }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') return `active: ${potId}`
  return [successLine('Active pot set', mode), kv('pot', potId, mode)].join(NL)
}

/** `pots registry remove <potId>` — local access removal only. No on-chain effect. */
export async function runPotsRegistryRemove(
  argv: string[],
  mode: OutputMode,
  deps: PotsRegistryCommandDeps = {},
): Promise<string> {
  const potId = argv.find((a) => !a.startsWith('-'))?.trim()
  if (!potId) throw new Error('Usage: zappi-cli pots registry remove <potId>')
  const removed = await removePot(potId, { env: depsEnv(deps) })
  const result = { ok: true as const, command: 'pots registry remove' as const, potId, removed }
  if (mode === 'json') return jsonOut(result)
  if (!removed) {
    if (mode === 'plain') return `not in registry: ${potId}`
    return errorLine(`Pot ${potId} is not in the registry.`, mode)
  }
  if (mode === 'plain') return `removed (local): ${potId}`
  return [
    successLine('Removed local registry access', mode),
    kv('pot', potId, mode),
    warnLine('This removes local access only. It does not revoke on-chain access and does not zeroize memory/disk.', mode),
    warnLine('If the seed was exposed, create a fresh pot and migrate funds with human authorization.', mode),
  ].join(NL)
}

/** `pots registry import --pot-id <id> [--from-file <path>] [--label <l>]` */
export async function runPotsRegistryImport(
  argv: string[],
  mode: OutputMode,
  deps: PotsRegistryCommandDeps = {},
): Promise<string> {
  const env = depsEnv(deps)
  const strings = parseStrings(argv)
  const potId = strings['pot-id']?.trim() || env.ZAPPI_POT_ID?.trim()
  if (!potId) throw new Error('Pass --pot-id <id> (or set ZAPPI_POT_ID). The mnemonic is never a CLI flag.')
  const label = strings.label?.trim() || undefined
  const network = resolveSparkNetwork(env)
  const accountIndex = 0
  const fromFile = strings['from-file']?.trim()

  // Never accept the mnemonic as argv. Read from a masked TTY prompt or a 0600 file.
  let seed: string
  if (fromFile) {
    const text = readFileSync(fromFile, 'utf8')
    const phrase = extractPhraseFromKeyFile(text)
    if (!phrase) throw new Error(`No recovery phrase found in ${fromFile}.`)
    seed = phrase
  } else {
    const ask = deps.askSecret ?? askSecret
    const entered = (await ask('Paste the pot recovery phrase (input hidden):')).trim()
    if (!entered || !looksLikeMnemonicPhrase(entered)) {
      throw new Error('That is not a 12/24-word recovery phrase. Import cancelled; nothing was stored.')
    }
    seed = entered
  }

  const deriveAddress = deps.deriveAddress ?? defaultDeriveAddress
  const sparkAddress = await deriveAddress(seed, network, accountIndex)
  const passphrase = resolvePotPassphrase(env)

  await savePotSeed(
    {
      potId,
      ...(label ? { label } : {}),
      sparkAddress,
      spendMode: 'free',
      network,
      derivationMode: 'spark',
      accountIndex,
      seed,
    },
    passphrase,
    { env, ...(deps.now ? { now: deps.now } : {}) },
  )

  const result = { ok: true as const, command: 'pots registry import' as const, potId, sparkAddress, network }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') return `${potId} ${sparkAddress} ${network}`
  return [
    successLine('Pot imported and sealed in the encrypted registry', mode),
    kv('pot', potId, mode),
    kv('address', sparkAddress, mode),
    kv('network', network, mode),
    infoLine('Seed sealed to ~/.zappi/pots.json. Set ZAPPI_POT_PASSPHRASE as a host secret to sign.', mode),
  ].join(NL)
}

/** `pots registry rotate-passphrase` — re-encrypt all pots under a new passphrase. */
export async function runPotsRegistryRotatePassphrase(
  mode: OutputMode,
  deps: PotsRegistryCommandDeps = {},
): Promise<string> {
  const env = depsEnv(deps)
  const oldPassphrase = resolvePotPassphrase(env)
  const ask = deps.askSecret ?? askSecret
  const newPassphrase = (await ask('New ZAPPI_POT_PASSPHRASE (input hidden):')).trim()
  if (!newPassphrase || newPassphrase.length < 16) {
    throw new Error('New passphrase must be at least 16 characters. Rotation cancelled; registry unchanged.')
  }
  const confirm = (await ask('Confirm new passphrase (input hidden):')).trim()
  if (newPassphrase !== confirm) {
    throw new Error('Passphrases did not match. Rotation cancelled; registry unchanged.')
  }

  const pots = await listPots({ env })
  if (pots.length === 0) throw new Error('Registry is empty; nothing to rotate.')
  const { reseedAll } = await import('./pot-registry-rotate.js')
  const rotated = await reseedAll(potRegistryPath(env), oldPassphrase, newPassphrase, { env })

  const result = { ok: true as const, command: 'pots registry rotate-passphrase' as const, rotated, note: 'Old ciphertext and backups remain decryptable with the old passphrase; rotation does not revoke an exposed seed.' }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') return `rotated: ${rotated}`
  return [
    successLine(`Re-encrypted ${rotated} pot(s) under the new passphrase`, mode),
    warnLine('Old ciphertext and backups still decrypt with the old passphrase. Rotation does not revoke an exposed seed.', mode),
    warnLine('If a seed was exposed, create a fresh pot and migrate funds with human authorization.', mode),
  ].join(NL)
}

/** `pots registry backup <path>` — copy the encrypted registry (ciphertext) to <path>. */
export async function runPotsRegistryBackup(
  argv: string[],
  mode: OutputMode,
  deps: PotsRegistryCommandDeps = {},
): Promise<string> {
  const target = argv.find((a) => !a.startsWith('-'))?.trim()
  if (!target) throw new Error('Usage: zappi-cli pots registry backup <path>')
  const src = potRegistryPath(depsEnv(deps))
  const data = readFileSync(src)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, data, { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(target, 0o600)
  const result = { ok: true as const, command: 'pots registry backup' as const, path: target, bytes: data.length }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') return `backup: ${target} (${data.length} bytes)`
  return [successLine('Encrypted registry backed up', mode), kv('path', target, mode), kv('size', `${data.length} bytes`, mode)].join(NL)
}

/** `pots registry restore <path>` — replace the registry from an encrypted backup. */
export async function runPotsRegistryRestore(
  argv: string[],
  mode: OutputMode,
  deps: PotsRegistryCommandDeps = {},
): Promise<string> {
  const src = argv.find((a) => !a.startsWith('-'))?.trim()
  if (!src) throw new Error('Usage: zappi-cli pots registry restore <path>')
  const env = depsEnv(deps)
  const dest = potRegistryPath(env)
  const data = readFileSync(src, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error(`Backup at ${src} is not valid JSON.`)
  }
  // Validate before overwriting so a corrupt backup never destroys the live registry.
  const file = validateRegistryFile(parsed)
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
  writeFileSync(dest, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(dest, 0o600)
  const count = Object.keys(file.pots).length
  const result = { ok: true as const, command: 'pots registry restore' as const, path: dest, pots: count }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') return `restored: ${dest} (${count} pots)`
  return [
    successLine('Encrypted registry restored', mode),
    kv('path', dest, mode),
    kv('pots', String(count), mode),
    infoLine('Identity is verified on first decrypt (seed-derived address must match each stored pot).', mode),
  ].join(NL)
}

/* -------------------------------- helpers --------------------------------- */

function parseStrings(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a?.startsWith('--') && next && !next.startsWith('--')) {
      out[a.slice(2)] = next
      i++
    }
  }
  return out
}

async function defaultDeriveAddress(seed: string, network: 'MAINNET' | 'REGTEST', accountIndex: number): Promise<string> {
  const { SparkWallet } = await import('@buildonspark/spark-sdk')
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: seed,
    accountNumber: accountIndex,
    options: { network },
  })
  try {
    return await wallet.getSparkAddress()
  } finally {
    await wallet.cleanupConnections()
  }
}

const REGISTRY_USAGE =
  'Usage: zappi-cli pots registry <list|use|remove|import|rotate-passphrase|backup|restore> ...'

/** Dispatch `pots registry <sub>`. `sub` undefined → `list`. */
export async function runPotsRegistry(
  sub: string | undefined,
  argv: string[],
  mode: OutputMode,
  deps: PotsRegistryCommandDeps = {},
): Promise<string> {
  if (!sub || sub === 'list') return runPotsRegistryList(mode, deps)
  if (sub === 'use') return runPotsRegistryUse(argv, mode, deps)
  if (sub === 'remove') return runPotsRegistryRemove(argv, mode, deps)
  if (sub === 'import') return runPotsRegistryImport(argv, mode, deps)
  if (sub === 'rotate-passphrase') return runPotsRegistryRotatePassphrase(mode, deps)
  if (sub === 'backup') return runPotsRegistryBackup(argv, mode, deps)
  if (sub === 'restore') return runPotsRegistryRestore(argv, mode, deps)
  throw new Error(REGISTRY_USAGE)
}
