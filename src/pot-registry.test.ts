import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, chmodSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  savePotSeed,
  loadPotSeedFromRegistry,
  listPots,
  removePot,
  setActivePot,
  getActivePot,
  getPotRecord,
  sealSeed,
  openSeed,
  validateRegistryFile,
  canonicalAad,
  type PotRecord,
  type RegistryFile,
} from './pot-registry.js'

const PHRASE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
const PASSPHRASE = 'a-very-long-high-entropy-host-secret-passphrase-0123456789'

interface CaseEnv {
  ZAPPI_POT_REGISTRY_FILE: string
  ZAPPI_API_URL: string
  ZAPPI_APP_ORIGIN: string
}

function tmpRegistry(): { env: CaseEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'zappi-registry-'))
  const env: CaseEnv = {
    ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
    ZAPPI_API_URL: 'https://api.test.zappi.money',
    ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
  }
  return { env, dir }
}

function baseInput(potId: string) {
  return {
    potId,
    label: 'Research',
    sparkAddress: 'spark1exampleaddress0000000000000000',
    spendMode: 'free' as const,
    network: 'MAINNET' as const,
    derivationMode: 'spark' as const,
    accountIndex: 1,
    seed: PHRASE,
  }
}

describe('pot-registry round trip', () => {
  it('saves then loads the same seed, and never persists it in plaintext', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const { seed, record } = await loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env })
      assert.equal(seed, PHRASE)
      assert.equal(record.potId, 'pot_a')
      const raw = readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')
      assert.equal(raw.includes(PHRASE), false, 'seed must not appear in the registry file')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes the registry file with mode 0600 and dir 0700', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const fileMode = statSync(env.ZAPPI_POT_REGISTRY_FILE).mode & 0o777
      const dirMode = statSync(dir).mode & 0o777
      assert.equal(fileMode, 0o600)
      assert.equal(dirMode, 0o700)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pot-registry auth', () => {
  it('rejects a wrong passphrase (GCM tag fails)', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      await assert.rejects(
        () => loadPotSeedFromRegistry('pot_a', 'wrong-passphrase', { env }),
        /could not be authenticated/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects ciphertext tampering', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const raw = JSON.parse(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')) as RegistryFile
      const rec = raw.pots.pot_a as PotRecord
      // flip one byte in the ciphertext
      const buf = Buffer.from(rec.ciphertextB64, 'base64')
      buf[0] ^= 0xff
      rec.ciphertextB64 = buf.toString('base64')
      writeFileSync(env.ZAPPI_POT_REGISTRY_FILE, JSON.stringify(raw, null, 2))
      chmodSync(env.ZAPPI_POT_REGISTRY_FILE, 0o600)
      await assert.rejects(
        () => loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env }),
        /could not be authenticated/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects substituted metadata (AAD binds sparkAddress)', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const raw = JSON.parse(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')) as RegistryFile
      (raw.pots.pot_a as PotRecord).sparkAddress = 'spark1attackeraddress00000000000000000'
      writeFileSync(env.ZAPPI_POT_REGISTRY_FILE, JSON.stringify(raw, null, 2))
      chmodSync(env.ZAPPI_POT_REGISTRY_FILE, 0o600)
      await assert.rejects(
        () => loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env }),
        /could not be authenticated/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pot-registry schema validation', () => {
  it('rejects an unknown version', () => {
    assert.throws(() => validateRegistryFile({ version: 99, pots: {} }), /unsupported/)
  })

  it('rejects a prototype-pollution key', () => {
    // JSON.parse creates __proto__ as an own key (DefineOwnProperty semantics),
    // unlike an object literal which would set the prototype instead.
    const raw = JSON.parse(
      '{"version":1,"pots":{"__proto__":{"potId":"__proto__","sparkAddress":"x","spendMode":"free","network":"MAINNET","derivationMode":"spark","accountIndex":1,"apiUrl":"u","appOrigin":"o","createdAt":"c","saltB64":"","ivB64":"","tagB64":"","ciphertextB64":""}}}',
    )
    assert.throws(() => validateRegistryFile(raw), /prototype/)
  })

  it('rejects when the dictionary key differs from record potId', () => {
    const env = { ZAPPI_API_URL: 'u', ZAPPI_APP_ORIGIN: 'o' } as CaseEnv
    const meta = {
      potId: 'pot_a',
      sparkAddress: 'spark1x',
      spendMode: 'free' as const,
      network: 'MAINNET' as const,
      derivationMode: 'spark' as const,
      accountIndex: 1,
      apiUrl: 'u',
      appOrigin: 'o',
      createdAt: 'c',
    }
    const env2 = sealSeed(PHRASE, PASSPHRASE, meta)
    assert.throws(
      () => validateRegistryFile({ version: 1, pots: { pot_b: { ...meta, ...env2 } } }),
      /dictionary key must equal/,
    )
    void env
  })

  it('refuses a registry file with group/other read permission', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      chmodSync(env.ZAPPI_POT_REGISTRY_FILE, 0o644)
      await assert.rejects(
        () => loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env }),
        /other users can read/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a symlinked registry file', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const link = join(dir, 'link.json')
      symlinkSync(env.ZAPPI_POT_REGISTRY_FILE, link)
      await assert.rejects(
        () => loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env: { ...env, ZAPPI_POT_REGISTRY_FILE: link } }),
        /symlink/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an oversized file', async () => {
    const { env, dir } = tmpRegistry()
    try {
      writeFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'x'.repeat(2 << 20))
      chmodSync(env.ZAPPI_POT_REGISTRY_FILE, 0o600)
      await assert.rejects(
        () => loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env }),
        /too large|not valid JSON/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pot-registry multi-pot', () => {
  it('lists, switches active, and removes pots without leaking the seed', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      await savePotSeed({ ...baseInput('pot_b'), label: 'Ops' }, PASSPHRASE, { env })
      const pots = await listPots({ env })
      assert.equal(pots.length, 2)
      const labels = pots.map((p) => p.label).sort()
      assert.deepEqual(labels, ['Ops', 'Research'])
      assert.equal(pots.every((p) => !('seed' in p) && !('ciphertextB64' in p)), true)

      await setActivePot('pot_b', { env })
      assert.equal(await getActivePot({ env }), 'pot_b')

      assert.equal(await removePot('pot_a', { env }), true)
      const after = await listPots({ env })
      assert.equal(after.length, 1)
      assert.equal(after[0].potId, 'pot_b')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('serializes concurrent writers so no entry is lost', async () => {
    const { env, dir } = tmpRegistry()
    try {
      const ids = Array.from({ length: 8 }, (_, i) => `pot_${i}`)
      await Promise.all(ids.map((id) => savePotSeed({ ...baseInput(id), label: id }, PASSPHRASE, { env })))
      const pots = await listPots({ env })
      assert.equal(pots.length, ids.length)
      const stored = new Set(pots.map((p) => p.potId))
      for (const id of ids) assert.equal(stored.has(id), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pot-registry endpoint trust', () => {
  it('fails closed when the stored API endpoint differs from trusted env', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const drifted: CaseEnv = {
        ...env,
        ZAPPI_API_URL: 'https://attacker.example',
        ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
      }
      await assert.rejects(
        () => loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env: drifted }),
        /untrusted API\/app origin/,
      )
      await assert.rejects(
        () => getPotRecord('pot_a', { env: drifted }),
        /untrusted API\/app origin/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pot-registry free-only', () => {
  it('refuses to seal an auth_required pot', async () => {
    const { env, dir } = tmpRegistry()
    try {
      await assert.rejects(
        () => savePotSeed({ ...baseInput('pot_a'), spendMode: 'auth_required' } as never, PASSPHRASE, { env }),
        /Only free pots/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('canonicalAad', () => {
  it('is stable regardless of object key order', () => {
    const meta = {
      potId: 'pot_a',
      sparkAddress: 'spark1x',
      spendMode: 'free' as const,
      network: 'MAINNET' as const,
      derivationMode: 'spark' as const,
      accountIndex: 1,
      apiUrl: 'u',
      appOrigin: 'o',
      createdAt: 'c',
    }
    const a = canonicalAad(meta)
    const b = canonicalAad({
      appOrigin: meta.appOrigin,
      apiUrl: meta.apiUrl,
      createdAt: meta.createdAt,
      accountIndex: meta.accountIndex,
      derivationMode: meta.derivationMode,
      network: meta.network,
      potId: meta.potId,
      sparkAddress: meta.sparkAddress,
      spendMode: meta.spendMode,
    })
    assert.deepEqual(a, b)
  })
})
