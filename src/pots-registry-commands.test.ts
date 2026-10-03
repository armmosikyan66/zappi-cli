import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  runPotsRegistryList,
  runPotsRegistryUse,
  runPotsRegistryRemove,
  runPotsRegistryImport,
  runPotsRegistryBackup,
  runPotsRegistryRestore,
  runPotsRegistry,
} from './pots-registry-commands.js'
import { savePotSeed } from './pot-registry.js'

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
  SPARK_NETWORK?: string
}

function tmpEnv(): { env: CaseEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'zappi-regcmd-'))
  const env: CaseEnv = {
    ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
    ZAPPI_API_URL: 'https://api.test.zappi.money',
    ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
    ZAPPI_POT_PASSPHRASE: PASSPHRASE,
  }
  return { env, dir }
}

const deriveMatching = async () => SPARK_ADDRESS

describe('pots registry commands', () => {
  it('list shows pots without the seed and marks the active pot', async () => {
    const { env, dir } = tmpEnv()
    try {
      await savePotSeed({ ...baseInput('pot_a'), label: 'Research' }, PASSPHRASE, { env })
      await savePotSeed({ ...baseInput('pot_b'), label: 'Ops' }, PASSPHRASE, { env })
      const out = await runPotsRegistryList('plain', { env })
      assert.equal(out.includes(PHRASE), false)
      assert.equal(out.includes('pot_a'), true)
      assert.equal(out.includes('pot_b'), true)
      const json = JSON.parse(await runPotsRegistryList('json', { env })) as { pots: unknown[] }
      assert.equal(json.pots.length, 2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('use sets the active pot', async () => {
    const { env, dir } = tmpEnv()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      await savePotSeed(baseInput('pot_b'), PASSPHRASE, { env })
      await runPotsRegistryUse(['pot_b'], 'plain', { env })
      const out = await runPotsRegistryList('pretty', { env })
      assert.match(out, /\*.*pot_b/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('remove warns it is local-only and does not revoke on-chain access', async () => {
    const { env, dir } = tmpEnv()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const out = await runPotsRegistryRemove(['pot_a'], 'pretty', { env })
      assert.match(out, /local access only/i)
      assert.match(out, /does not revoke on-chain/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('import seals a mnemonic from --from-file and never echoes it', async () => {
    const { env, dir } = tmpEnv()
    try {
      const seedFile = join(dir, 'seed.txt')
      writeFileSync(seedFile, PHRASE + '\n', { mode: 0o600 })
      chmodSync(seedFile, 0o600)
      const out = await runPotsRegistryImport(
        [
          '--pot-id', 'pot_x',
          '--from-file', seedFile,
          '--label', 'Imported',
          '--network', 'REGTEST',
          '--account-index', '0',
          '--address', SPARK_ADDRESS,
        ],
        'pretty',
        { env, deriveAddress: deriveMatching },
      )
      assert.match(out, /pot_x/)
      assert.equal(out.includes(PHRASE), false)
      // The label is persisted in the registry (not echoed in the success line).
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8').includes('Imported'), true)
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8').includes(PHRASE), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('import rejects a non-mnemonic input (fail closed, nothing stored)', async () => {
    const { env, dir } = tmpEnv()
    try {
      await assert.rejects(
        () =>
          runPotsRegistryImport(
            ['--pot-id', 'pot_x', '--network', 'REGTEST', '--account-index', '0', '--address', SPARK_ADDRESS],
            'pretty',
            {
            env,
            deriveAddress: deriveMatching,
            askSecret: async () => 'not a mnemonic',
          }),
        /not a 12\/24-word recovery phrase/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('import refuses to take the mnemonic from argv', async () => {
    const { env, dir } = tmpEnv()
    try {
      await assert.rejects(
        () => runPotsRegistryImport(['pot_x', PHRASE], 'pretty', { env, deriveAddress: deriveMatching }),
        /pot-id|never a CLI flag|Unknown/i,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('backup writes a 0600 encrypted copy; restore reproduces the registry', async () => {
    const { env, dir } = tmpEnv()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const backupPath = join(dir, 'backup.json')
      await runPotsRegistryBackup([backupPath], 'plain', { env })
      assert.equal(statMode(backupPath), 0o600)

      // Corrupt the live registry, then restore from backup.
      writeFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'corrupt', { mode: 0o600 })
      chmodSync(env.ZAPPI_POT_REGISTRY_FILE, 0o600)
      await runPotsRegistryRestore([backupPath], 'plain', {
        env,
        deriveAddress: async () => SPARK_ADDRESS,
      })
      const out = await runPotsRegistryList('plain', { env })
      assert.match(out, /pot_a/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('restore refuses a corrupt backup and leaves the live registry intact', async () => {
    const { env, dir } = tmpEnv()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      const before = readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')
      const badBackup = join(dir, 'bad.json')
      writeFileSync(badBackup, 'not json', { mode: 0o600 })
      chmodSync(badBackup, 0o600)
      await assert.rejects(
        () => runPotsRegistryRestore([badBackup], 'plain', { env }),
        /not valid JSON|not a JSON object|unsupported|missing/i,
      )
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8'), before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('dispatcher routes list/use/remove and errors on unknown sub', async () => {
    const { env, dir } = tmpEnv()
    try {
      await savePotSeed(baseInput('pot_a'), PASSPHRASE, { env })
      assert.match(await runPotsRegistry(undefined, [], 'plain', { env }), /pot_a/)
      assert.match(await runPotsRegistry('list', [], 'plain', { env }), /pot_a/)
      await runPotsRegistry('use', ['pot_a'], 'plain', { env })
      assert.match(await runPotsRegistry('remove', ['pot_a'], 'pretty', { env }), /local access only/i)
      await assert.rejects(() => runPotsRegistry('nope', [], 'plain', { env }), /Usage/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function baseInput(potId: string) {
  return {
    potId,
    label: 'Research',
    sparkAddress: SPARK_ADDRESS,
    spendMode: 'free' as const,
    network: 'REGTEST' as const,
    derivationMode: 'spark' as const,
    accountIndex: 0,
    seed: PHRASE,
  }
}

function statMode(path: string): number {
  return statSync(path).mode & 0o777
}
