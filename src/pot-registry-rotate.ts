/**
 * Re-encrypt every pot in a registry under a new passphrase — Linear 1-456 stage 4 / 1-460.
 *
 * Rotation re-seals each seed with a fresh salt/nonce under the new passphrase.
 * It does NOT invalidate old ciphertext or old backups (they still decrypt
 * with the old passphrase), and it does NOT revoke an exposed seed. A
 * compromised seed requires a fresh independent pot + human-authorized
 * fund migration — never automated here.
 */

import {
  openSeed,
  sealSeed,
  updateRegistryAt,
  type PotRecord,
  type RegistryFile,
} from './pot-registry.js'
import type { PotEnv } from './env.js'

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
  void deps
  let count = 0
  // Decrypt every envelope first inside the registry lock. The atomic commit
  // runs only after all of them authenticate, so a wrong passphrase or a
  // tampered record leaves the live file untouched. Old ciphertext is not
  // revoked: anything still encrypted to the old secret still opens with it.
  await updateRegistryAt(registryPath, (file) => {
    const resealed: Record<string, PotRecord> = Object.create(null)
    for (const potId of Object.keys(file.pots)) {
      const record = file.pots[potId]
      if (!record) continue
      const seed = openSeed(record, oldPassphrase, record)
      resealed[potId] = { ...record, ...sealSeed(seed, newPassphrase, record) }
      count += 1
    }
    const provisions: Record<string, PotRecord> = Object.create(null)
    for (const provisionId of Object.keys(file.provisions ?? {})) {
      const record = file.provisions?.[provisionId]
      if (!record) continue
      const seed = openSeed(record, oldPassphrase, record)
      provisions[provisionId] = { ...record, ...sealSeed(seed, newPassphrase, record) }
      count += 1
    }
    const next: RegistryFile = {
      version: file.version,
      ...(file.activePotId ? { activePotId: file.activePotId } : {}),
      pots: resealed,
      ...(Object.keys(provisions).length > 0 ? { provisions } : {}),
    }
    return next
  })
  return count
}
