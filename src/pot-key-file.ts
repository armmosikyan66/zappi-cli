import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const FILE_MODE = 0o600
const DIR_MODE = 0o700

function labelSlug(label?: string): string {
  return (
    label
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ?? ''
  )
}

/** `~/.zappi/pot-<slug>-<stamp>.txt`, or `new-pot-<stamp>.txt` when unlabeled. */
export function defaultKeyFile(label?: string): string {
  const stamp = Date.now().toString(36)
  const slug = labelSlug(label)
  const name = slug ? `pot-${slug}-${stamp}.txt` : `new-pot-${stamp}.txt`
  return join(homedir(), '.zappi', name)
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Blank keeps the suggested file. A directory (or a trailing slash) writes
 * the suggested filename inside that folder so we never `open()` a directory.
 */
export function resolveKeyFilePath(answer: string | undefined, suggested: string): string {
  const trimmed = answer?.trim() ?? ''
  if (!trimmed) return suggested
  const expanded = expandHome(trimmed)
  const trailingSlash = expanded.endsWith('/') || expanded.endsWith('\\')
  try {
    if (statSync(expanded).isDirectory() || trailingSlash) {
      return join(expanded, basename(suggested))
    }
  } catch {
    if (trailingSlash) return join(expanded, basename(suggested))
  }
  return expanded
}

/**
 * Write the pot spend key as a mode-0600 text file.
 * The phrase is the last non-label line so `loadPotSeed` can read it back.
 * Callers must not print or log `mnemonic`.
 */
export function writeKeyFile(
  path: string,
  mnemonic: string,
  sparkAddress: string,
  label?: string,
): void {
  const safeLabel = label?.replace(/[\r\n]/g, ' ').trim()
  const lines = [
    'Zappi agent pot key',
    ...(safeLabel ? [`Label: ${safeLabel}`] : []),
    `Wallet address: ${sparkAddress}`,
    '',
    'This file is the pot spend key. Store it as a host secret (ZAPPI_POT_SEED).',
    'Do not print, email, or paste this file.',
    '',
    mnemonic.trim(),
    '',
  ]
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE })
  writeFileSync(path, lines.join('\n'), { encoding: 'utf8', mode: FILE_MODE })
  if (process.platform !== 'win32') chmodSync(path, FILE_MODE)
}

/** Public Spark address for a fresh pot key. Does not print the mnemonic. */
export async function deriveSparkAddress(
  mnemonic: string,
  network: 'MAINNET' | 'REGTEST',
): Promise<string> {
  const { SparkWallet } = await import('@buildonspark/spark-sdk')
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: mnemonic,
    accountNumber: 0,
    options: { network },
  })
  try {
    return await wallet.getSparkAddress()
  } finally {
    await wallet.cleanupConnections()
  }
}
