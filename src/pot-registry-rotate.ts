/**
 * Re-encrypt every pot in a registry under a new passphrase — Linear 1-456 stage 4 / 1-460.
 *
 * Rotation re-seals each seed with a fresh salt/nonce under the new passphrase.
 * It does NOT invalidate old ciphertext or old backups (they still decrypt
 * with the old passphrase), and it does NOT revoke an exposed seed. A
 * compromised seed requires a fresh independent pot + human-authorized
 * fund migration — never automated here.
 */

import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  openSeed,
  sealSeed,
  validateRegistryFile,
  type PotRecord,
  type RegistryFile,
} from './pot-registry.js'
import { potRegistryPath, type PotEnv } from './env.js'

const FILE_MODE = 0o600
const DIR_MODE = 0o700

export interface ReseedDeps {
  env?: PotEnv
}

/**
 * Re-encrypt every pot in the registry at `registryPath` from `oldPassphrase`
 * to `newPassphrase`. Returns the number of pots re-sealed. Throws if any
 * pot fails to authenticate under the old passphrase (fail closed — partial
 * rotation is never written).
 */
export async function reseedAll(
  registryPath: string,
  oldPassphrase: string,
  newPassphrase: string,
  deps: ReseedDeps = {},
): Promise<number> {
  const raw = readFileSync(registryPath, 'utf8')
  const file = validateRegistryFile(JSON.parse(raw))
  const resealed: Record<string, PotRecord> = Object.create(null)
  const potIds = Object.keys(file.pots)

  // Decrypt + re-seal every pot first; only write if all succeed.
  for (const potId of potIds) {
    const record = file.pots[potId]
    if (!record) continue
    const seed = openSeed(record, oldPassphrase, record)
    const envelope = sealSeed(seed, newPassphrase, record)
    resealed[potId] = { ...record, ...envelope }
  }

  const next: RegistryFile = {
    version: file.version,
    ...(file.activePotId ? { activePotId: file.activePotId } : {}),
    pots: resealed,
  }

  mkdirSync(dirname(registryPath), { recursive: true, mode: DIR_MODE })
  writeFileSync(registryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: FILE_MODE })
  if (process.platform !== 'win32') chmodSync(registryPath, FILE_MODE)
  void deps
  return potIds.length
}
