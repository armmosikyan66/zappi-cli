import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { resolvePotContext } from './pot-context.js'
import { savePotSeed, setActivePot } from './pot-registry.js'

const PHRASE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
const PASSPHRASE = 'a-very-long-high-entropy-host-secret-passphrase-0123456789'
const SPARK_ADDRESS = 'spark1exampleaddress0000000000000000'

interface CaseEnv {
  ZAPPI_POT_REGISTRY_FILE: string
  ZAPPI_API_URL: string
  ZAPPI_APP_ORIGIN: string
  ZAPPI_POT_PASSPHRASE?: string
  ZAPPI_POT_ID?: string
  ZAPPI_POT_SEED?: string
  ZAPPI_POT_KEY_FILE?: string
  ZAPPI_POT_SPARK_ADDRESS?: string
  ZAPPI_POT_SPEND_MODE?: string
  SPARK_NETWORK?: string
}

function tmpRegistry(): { env: CaseEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'zappi-ctx-'))
  const env: CaseEnv = {
    ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
    ZAPPI_API_URL: 'https://api.test.zappi.money',
    ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
    ZAPPI_POT_PASSPHRASE: PASSPHRASE,
  }
  return { env, dir }
}

/** Fake derivation that always returns the pot's stored address (matches identity). */
function deriveMatching(_seed: string, _network: string, _accountIndex: number): Promise<string> {
  return Promise.resolve(SPARK_ADDRESS)
}

function deriveWrong(_seed: string, _network: string, _accountIndex: number): Promise<string> {
  return Promise.resolve('spark1attackeraddress00000000000000000')
}

function baseInput(potId: string) {
  return {
    potId,
    label: 'Research',
    sparkAddress: SPARK_ADDRESS,
    spendMode: 'free' as const,
    network: 'MAINNET' as const,
    derivationMode: 'spark' as const,
    accountIndex: 1,
    seed: PHRASE,
  }
}

describe('resolvePotContext — registry path', () => {
  it('resolves an immutable context bound to the registry identity', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const ctx = await resolvePotContext({ potFlag: 'pot_a' }, { env, deriveAddress: deriveMatching })
      assert.equal(ctx.potId, 'pot_a')
      assert.equal(ctx.sparkAddress, SPARK_ADDRESS)
      assert.equal(ctx.spendMode, 'free')
      assert.equal(ctx.source, 'registry')
      assert.equal(ctx.getSeed(), PHRASE)
      // immutable
      assert.throws(() => {
        ;(ctx as { potId: string }).potId = 'tampered'
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed when the derived address does not match the registry identity', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      await assert.rejects(
        () => resolvePotContext({ potFlag: 'pot_a' }, { env, deriveAddress: deriveWrong }),
        /does not match the registry identity/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed on wrong passphrase and does NOT fall back to env/file', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      await assert.rejects(
        () => resolvePotContext({ potFlag: 'pot_a' }, { env, passphrase: 'wrong' }),
        /could not be authenticated/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an env seed set at the same time as a registry pot (conflict)', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      await assert.rejects(
        () =>
          resolvePotContext(
            { potFlag: 'pot_a' },
            { env: { ...env, ZAPPI_POT_SEED: PHRASE }, deriveAddress: deriveMatching },
          ),
        /registry is authoritative/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('resolvePotContext — selectors', () => {
  it('fails closed when --pot and ZAPPI_POT_ID disagree', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await assert.rejects(
        () => resolvePotContext({ potFlag: 'pot_a' }, { env: { ...env, ZAPPI_POT_ID: 'pot_b' } }),
        /Conflicting pot selectors/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses the registry active pot when no explicit selector is given', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      await savePotSeed(baseInput('pot_b'), PASSPHRASE, { env })
      await setActivePot('pot_b', { env })
      const ctx = await resolvePotContext({}, { env, deriveAddress: deriveMatching })
      assert.equal(ctx.potId, 'pot_b')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('explicit --pot wins over the registry active pot', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      await savePotSeed(baseInput('pot_b'), PASSPHRASE, { env })
      await setActivePot('pot_b', { env })
      const ctx = await resolvePotContext({ potFlag: 'pot_a' }, { env, deriveAddress: deriveMatching })
      assert.equal(ctx.potId, 'pot_a')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed when no pot can be selected', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await assert.rejects(() => resolvePotContext({}, { env }), /No pot selected/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('resolvePotContext — legacy path', () => {
  it('resolves from ZAPPI_POT_SEED with env defaults for network/derivation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-ctx-legacy-'))
    try {
      const env: CaseEnv = {
        ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
        ZAPPI_API_URL: 'https://api.test.zappi.money',
        ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
        ZAPPI_POT_ID: 'pot_legacy',
        ZAPPI_POT_SEED: PHRASE,
        ZAPPI_POT_SPARK_ADDRESS: SPARK_ADDRESS,
        SPARK_NETWORK: 'MAINNET',
      }
      const ctx = await resolvePotContext({}, { env, deriveAddress: deriveMatching })
      assert.equal(ctx.potId, 'pot_legacy')
      assert.equal(ctx.source, 'env')
      assert.equal(ctx.network, 'MAINNET')
      assert.equal(ctx.derivationMode, 'spark')
      assert.equal(ctx.accountIndex, 1)
      assert.equal(ctx.getSeed(), PHRASE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves from ZAPPI_POT_KEY_FILE (legacy opt-out)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-ctx-file-'))
    try {
      const keyFile = join(dir, 'pot.txt')
      writeFileSync(keyFile, PHRASE + '\n', { mode: 0o600 })
      chmodSync(keyFile, 0o600)
      const env: CaseEnv = {
        ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
        ZAPPI_API_URL: 'https://api.test.zappi.money',
        ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
        ZAPPI_POT_ID: 'pot_legacy',
        ZAPPI_POT_KEY_FILE: keyFile,
        ZAPPI_POT_SPARK_ADDRESS: SPARK_ADDRESS,
        SPARK_NETWORK: 'MAINNET',
      }
      const ctx = await resolvePotContext({}, { env, deriveAddress: deriveMatching })
      assert.equal(ctx.source, 'file')
      assert.equal(ctx.getSeed(), PHRASE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed when both env seed and key file are set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-ctx-conflict-'))
    try {
      const keyFile = join(dir, 'pot.txt')
      writeFileSync(keyFile, PHRASE + '\n', { mode: 0o600 })
      chmodSync(keyFile, 0o600)
      const env: CaseEnv = {
        ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
        ZAPPI_API_URL: 'https://api.test.zappi.money',
        ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
        ZAPPI_POT_ID: 'pot_legacy',
        ZAPPI_POT_SEED: PHRASE,
        ZAPPI_POT_KEY_FILE: keyFile,
      }
      await assert.rejects(
        () => resolvePotContext({}, { env, deriveAddress: deriveMatching }),
        /Conflicting seed sources/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed when the pot is not in the registry and no legacy source is set', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await assert.rejects(
        () => resolvePotContext({ potFlag: 'pot_missing' }, { env }),
        /not in the encrypted registry and no legacy seed source/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
