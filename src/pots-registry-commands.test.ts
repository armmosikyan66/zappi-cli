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
  runPotsRegistryUnlockSecret,
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
          '--network', 'MAINNET',
          '--account-index', '1',
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
            ['--pot-id', 'pot_x', '--network', 'MAINNET', '--account-index', '1', '--address', SPARK_ADDRESS],
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

  it('unlock-secret --set stores a prompted secret and never prints it', async () => {
    const { env, dir } = tmpEnv()
    const secret = 'dummy-unlock-secret-0001'
    const seen: string[] = []
    let got = false
    try {
      const out = await runPotsRegistryUnlockSecret(['--set', '--keychain'], 'json', {
        env: { ...env, ZAPPI_POT_SEED: PHRASE },
        askSecret: async () => secret,
        unlockKeychain: {
          getUnlockSecret: () => {
            got = true
            return null
          },
          setUnlockSecret: (value) => {
            seen.push(value)
          },
          deleteUnlockSecret: () => false,
        },
      })
      assert.deepEqual(seen, [secret])
      assert.equal(got, false)
      const parsed = JSON.parse(out) as { set?: boolean; present?: unknown; command: string }
      assert.equal(parsed.set, true)
      assert.equal(parsed.command, 'pots registry unlock-secret')
      assert.equal('present' in parsed, false)
      assert.equal(out.includes(secret), false)
      assert.equal(out.includes(PHRASE), false)
      assert.equal(out.includes(PASSPHRASE), false)
      const pretty = await runPotsRegistryUnlockSecret(['--keychain', '--set'], 'pretty', {
        env,
        askSecret: async () => `  ${secret}  `,
        unlockKeychain: {
          getUnlockSecret: () => null,
          setUnlockSecret: (value) => {
            seen.push(value)
          },
          deleteUnlockSecret: () => false,
        },
      })
      assert.equal(seen[1], secret)
      assert.equal(pretty.includes(secret), false)
      assert.match(pretty, /not printed/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('unlock-secret --delete never reads or prints the previous value', async () => {
    const { env, dir } = tmpEnv()
    const secret = 'dummy-unlock-secret-0001'
    try {
      const out = await runPotsRegistryUnlockSecret(['--delete', '--keychain'], 'json', {
        env,
        unlockKeychain: {
          getUnlockSecret: () => {
            throw new Error('get must not run on --delete')
          },
          setUnlockSecret: () => {
            throw new Error('set must not run on --delete')
          },
          deleteUnlockSecret: () => true,
        },
      })
      const parsed = JSON.parse(out) as { deleted: boolean }
      assert.equal(parsed.deleted, true)
      assert.equal(out.includes(secret), false)
      assert.equal(out.includes(PASSPHRASE), false)
      const absent = await runPotsRegistry('unlock-secret', ['--keychain', '--delete'], 'plain', {
        env,
        unlockKeychain: {
          getUnlockSecret: () => {
            throw new Error('get must not run on --delete')
          },
          setUnlockSecret: () => {
            throw new Error('set must not run')
          },
          deleteUnlockSecret: () => false,
        },
      })
      assert.equal(absent, 'absent')
      assert.equal(absent.includes(secret), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('unlock-secret status is a boolean and refuses argv secrets', async () => {
    const { env, dir } = tmpEnv()
    const secret = 'dummy-unlock-secret-0001'
    const leaked = 'dummy-should-not-appear-9999'
    try {
      const out = await runPotsRegistryUnlockSecret(['--keychain'], 'json', {
        env: { ZAPPI_POT_USE_KEYCHAIN: '0', ...env },
        unlockKeychain: {
          getUnlockSecret: () => secret,
          setUnlockSecret: () => {
            throw new Error('set must not run')
          },
          deleteUnlockSecret: () => {
            throw new Error('delete must not run')
          },
        },
      })
      const parsed = JSON.parse(out) as { present: boolean; keychain: boolean; set?: boolean }
      assert.equal(parsed.present, true)
      assert.equal(parsed.keychain, true)
      assert.equal(parsed.set, undefined)
      assert.equal(out.includes(secret), false)
      await assert.rejects(
        () =>
          runPotsRegistryUnlockSecret(['--set', leaked, '--keychain'], 'json', {
            env,
            unlockKeychain: {
              getUnlockSecret: () => null,
              setUnlockSecret: () => {
                throw new Error('must not store argv')
              },
              deleteUnlockSecret: () => false,
            },
          }),
        (error: Error) => {
          assert.match(error.message, /not a CLI argument/)
          assert.equal(error.message.includes(leaked), false)
          return true
        },
      )
      await assert.rejects(
        () => runPotsRegistryUnlockSecret(['--set', '--delete', '--keychain'], 'plain', { env }),
        /only one of --set or --delete/,
      )
      let asked = false
      await assert.rejects(
        () =>
          runPotsRegistryUnlockSecret(['--set'], 'plain', {
            env: { ...env, ZAPPI_POT_PASSPHRASE: undefined, ZAPPI_POT_USE_KEYCHAIN: undefined },
            askSecret: async () => {
              asked = true
              return secret
            },
          }),
        /Pass --keychain/,
      )
      assert.equal(asked, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('unlock-secret rejects a short or placeholder prompt and does not store it', async () => {
    const { env, dir } = tmpEnv()
    const short = 'tiny-secret-val'
    try {
      await assert.rejects(
        () =>
          runPotsRegistryUnlockSecret(['--set', '--keychain'], 'plain', {
            env,
            askSecret: async () => short,
            unlockKeychain: {
              getUnlockSecret: () => null,
              setUnlockSecret: () => {
                throw new Error('must not store')
              },
              deleteUnlockSecret: () => false,
            },
          }),
        (error: Error) => {
          assert.match(error.message, /at least 16/)
          assert.equal(error.message.includes(short), false)
          return true
        },
      )
      await assert.rejects(
        () =>
          runPotsRegistryUnlockSecret(['--keychain', '--set'], 'plain', {
            env: { ...env, ZAPPI_POT_USE_KEYCHAIN: '1' },
            askSecret: async () => '<not-a-real-secret>',
            unlockKeychain: {
              getUnlockSecret: () => null,
              setUnlockSecret: () => {
                throw new Error('must not store')
              },
              deleteUnlockSecret: () => false,
            },
          }),
        (error: Error) => {
          assert.match(error.message, /placeholder/)
          assert.equal(error.message.includes('not-a-real-secret'), false)
          return true
        },
      )
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
    network: 'MAINNET' as const,
    derivationMode: 'spark' as const,
    accountIndex: 1,
    seed: PHRASE,
  }
}

function statMode(path: string): number {
  return statSync(path).mode & 0o777
}
