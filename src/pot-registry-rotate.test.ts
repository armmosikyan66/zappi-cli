import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { savePotSeed, loadPotSeedFromRegistry } from './pot-registry.js'
import { reseedAll } from './pot-registry-rotate.js'

const PHRASE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
const OLD = 'old-passphrase-at-least-16-chars'
const NEW = 'new-passphrase-at-least-16-chars'

function baseInput(potId: string) {
  return {
    potId,
    label: 'Research',
    sparkAddress: 'spark1exampleaddress0000000000000000',
    spendMode: 'free' as const,
    network: 'REGTEST' as const,
    derivationMode: 'spark' as const,
    accountIndex: 0,
    seed: PHRASE,
  }
}

describe('reseedAll', () => {
  it('re-encrypts every pot under the new passphrase and leaves old ciphertext invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-rotate-'))
    const path = join(dir, 'pots.json')
    const env = {
      ZAPPI_POT_REGISTRY_FILE: path,
      ZAPPI_API_URL: 'https://api.test.zappi.money',
      ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
      ZAPPI_POT_PASSPHRASE: OLD,
    }
    try {
      await savePotSeed(baseInput('pot_a'), OLD, { env })
      await savePotSeed(baseInput('pot_b'), OLD, { env })

      const rotated = await reseedAll(path, OLD, NEW, { env })
      assert.equal(rotated, 2)

      // New passphrase decrypts.
      const a = await loadPotSeedFromRegistry('pot_a', NEW, { env: { ...env, ZAPPI_POT_PASSPHRASE: NEW } })
      assert.equal(a.seed, PHRASE)

      // Old passphrase no longer decrypts the re-sealed registry (fail closed).
      await assert.rejects(
        () => loadPotSeedFromRegistry('pot_a', OLD, { env }),
        /could not be authenticated/,
      )

      // Seed never appears in the file.
      assert.equal(readFileSync(path, 'utf8').includes(PHRASE), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed and writes nothing if any pot fails to authenticate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-rotate-fail-'))
    const path = join(dir, 'pots.json')
    const env = {
      ZAPPI_POT_REGISTRY_FILE: path,
      ZAPPI_API_URL: 'https://api.test.zappi.money',
      ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
      ZAPPI_POT_PASSPHRASE: OLD,
    }
    try {
      await savePotSeed(baseInput('pot_a'), OLD, { env })
      const before = readFileSync(path, 'utf8')
      await assert.rejects(
        () => reseedAll(path, 'wrong-passphrase', NEW, { env }),
        /could not be authenticated/,
      )
      // Registry unchanged on failure.
      assert.equal(readFileSync(path, 'utf8'), before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
