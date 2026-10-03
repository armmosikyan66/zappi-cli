/**
 * Regressions for the 1-467 review fixes (Linear 1-468).
 * No live transfers: signers are mocked or the command fails before signing.
 */

import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { bech32m } from '@scure/base'
import { spawnSanitized } from './child-env.js'
import { payResourceResult } from './paywall.js'
import { beginOperation, MAX_JOURNAL_BYTES } from './pending-ops.js'
import { resolvePotContext } from './pot-context.js'
import { savePotSeed, listPots, type PotRecord } from './pot-registry.js'
import {
  runPotsRegistryImport,
  runPotsRegistryRestore,
} from './pots-registry-commands.js'
import { gateAndSignFreePot } from './free-pot-sign.js'
import type { MoneyOutIntent } from './pot-outgate.js'

const PHRASE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
const PASSPHRASE = 'a-very-long-high-entropy-host-secret-passphrase-0123456789'
const ADDRESS = 'spark1exampleaddress0000000000000000'
const REGTEST = bech32m.encode('spark', bech32m.toWords(new Uint8Array(32).fill(4)))
const SPARKRT = bech32m.encode('sparkrt', bech32m.toWords(new Uint8Array(32).fill(4)))
const MAINNET = bech32m.encode('spark', bech32m.toWords(new Uint8Array(32).fill(5)))

function envIn(dir: string, file = 'pots.json') {
  return {
    ZAPPI_POT_REGISTRY_FILE: join(dir, file),
    ZAPPI_API_URL: 'https://api.test.zappi.money',
    ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
    ZAPPI_POT_PASSPHRASE: PASSPHRASE,
  }
}

describe('1-470 fresh registry directory', () => {
  it('lists and saves when the parent directory does not exist yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-fresh-'))
    const env = envIn(dir, join('nested', 'pots.json'))
    try {
      const listed = await listPots({ env })
      assert.deepEqual(listed, [])
      await savePotSeed(
        {
          potId: 'pot_a',
          sparkAddress: ADDRESS,
          spendMode: 'free',
          network: 'MAINNET',
          derivationMode: 'spark',
          accountIndex: 1,
          seed: PHRASE,
        },
        PASSPHRASE,
        { env },
      )
      const again = await listPots({ env })
      assert.equal(again.length, 1)
      assert.equal(again[0]?.potId, 'pot_a')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a symlink registry directory and a group-readable directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-unsafe-'))
    try {
      const real = join(dir, 'real')
      const link = join(dir, 'link')
      mkdirSync(real, { mode: 0o700 })
      symlinkSync(real, link)
      await assert.rejects(
        () => listPots({ env: envIn(dir, join('link', 'pots.json')) }),
        /symlink/,
      )
      const loose = join(dir, 'loose')
      mkdirSync(loose, { mode: 0o700 })
      chmodSync(loose, 0o755)
      await assert.rejects(
        () => listPots({ env: { ...envIn(dir), ZAPPI_POT_REGISTRY_FILE: join(loose, 'pots.json') } }),
        /other users/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-471 legacy identity', () => {
  it('rejects auth_required before reading the seed', async () => {
    let derived = false
    const dir = mkdtempSync(join(tmpdir(), 'zappi-auth-'))
    try {
      await assert.rejects(
        () =>
          resolvePotContext(
            {},
            {
              env: {
                ...envIn(dir),
                ZAPPI_POT_ID: 'pot_x',
                ZAPPI_POT_SEED: PHRASE,
                ZAPPI_POT_SPARK_ADDRESS: ADDRESS,
                ZAPPI_POT_SPEND_MODE: 'auth_required',
              },
              deriveAddress: async () => {
                derived = true
                return ADDRESS
              },
            },
          ),
        /auth_required/,
      )
      assert.equal(derived, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a legacy seed with no expected address before derivation', async () => {
    let derived = false
    const dir = mkdtempSync(join(tmpdir(), 'zappi-noid-'))
    try {
      await assert.rejects(
        () =>
          resolvePotContext(
            {},
            {
              env: {
                ...envIn(dir),
                ZAPPI_POT_ID: 'pot_x',
                ZAPPI_POT_SEED: PHRASE,
              },
              deriveAddress: async () => {
                derived = true
                return ADDRESS
              },
            },
          ),
        /ZAPPI_POT_SPARK_ADDRESS/,
      )
      assert.equal(derived, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a seed that does not match the expected address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-mismatch-'))
    try {
      await assert.rejects(
        () =>
          resolvePotContext(
            {},
            {
              env: {
                ...envIn(dir),
                ZAPPI_POT_ID: 'pot_x',
                ZAPPI_POT_SEED: PHRASE,
                ZAPPI_POT_SPARK_ADDRESS: ADDRESS,
                SPARK_NETWORK: 'MAINNET',
              },
              deriveAddress: async () => 'spark1someoneelse000000000000000000',
            },
          ),
        /does not match ZAPPI_POT_SPARK_ADDRESS/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-473 import keeps the original identity', () => {
  it('refuses to replace REGTEST account 3 with a different address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-import-'))
    const env = envIn(dir)
    try {
      await savePotSeed(
        {
          potId: 'pot_a',
          sparkAddress: ADDRESS,
          spendMode: 'free',
          network: 'MAINNET',
          derivationMode: 'spark',
          accountIndex: 1,
          seed: PHRASE,
        },
        PASSPHRASE,
        { env },
      )
      const seedFile = join(dir, 'seed.txt')
      writeFileSync(seedFile, PHRASE + '\n', { mode: 0o600 })
      chmodSync(seedFile, 0o600)
      await assert.rejects(
        () =>
          runPotsRegistryImport(
            [
              '--pot-id', 'pot_a',
              '--from-file', seedFile,
              '--network', 'MAINNET',
              '--account-index', '1',
              '--address', 'spark1other000000000000000000000000',
            ],
            'plain',
            { env, deriveAddress: async () => 'spark1other000000000000000000000000' },
          ),
        /Refusing to replace/,
      )
      const pots = await listPots({ env })
      assert.equal(pots[0]?.network, 'MAINNET')
      assert.equal(pots[0]?.accountIndex, 1)
      assert.equal(pots[0]?.sparkAddress, ADDRESS)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-474 restore does not follow a symlink or accept tampered ciphertext', () => {
  it('leaves the live registry intact when ciphertext is tampered', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-tamper-'))
    const env = envIn(dir)
    try {
      await savePotSeed(
        {
          potId: 'pot_a',
          sparkAddress: ADDRESS,
          spendMode: 'free',
          network: 'MAINNET',
          derivationMode: 'spark',
          accountIndex: 1,
          seed: PHRASE,
        },
        PASSPHRASE,
        { env },
      )
      const live = readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')
      const parsed = JSON.parse(live) as { pots: { pot_a: PotRecord } }
      const record = parsed.pots.pot_a
      const flipped = Buffer.from(record.ciphertextB64, 'base64')
      flipped[0] = (flipped[0] ?? 0) ^ 0xff
      record.ciphertextB64 = flipped.toString('base64')
      const backup = join(dir, 'bad-backup.json')
      writeFileSync(backup, JSON.stringify(parsed), { mode: 0o600 })
      chmodSync(backup, 0o600)
      await assert.rejects(
        () => runPotsRegistryRestore([backup], 'plain', { env }),
        /could not be authenticated|tampered|Wrong ZAPPI_POT_PASSPHRASE/i,
      )
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8'), live)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a registry path that is a symlink', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-symlink-'))
    const env = envIn(dir)
    try {
      await savePotSeed(
        {
          potId: 'pot_a',
          sparkAddress: ADDRESS,
          spendMode: 'free',
          network: 'MAINNET',
          derivationMode: 'spark',
          accountIndex: 1,
          seed: PHRASE,
        },
        PASSPHRASE,
        { env },
      )
      const outside = join(dir, 'outside.json')
      writeFileSync(outside, '{"keep":true}\n', { mode: 0o600 })
      const link = join(dir, 'linked.json')
      symlinkSync(outside, link)
      const backup = join(dir, 'backup.json')
      writeFileSync(backup, readFileSync(env.ZAPPI_POT_REGISTRY_FILE), { mode: 0o600 })
      chmodSync(backup, 0o600)
      await assert.rejects(
        () =>
          runPotsRegistryRestore([backup], 'plain', {
            env: { ...env, ZAPPI_POT_REGISTRY_FILE: link },
            deriveAddress: async () => ADDRESS,
          }),
        /symlink/,
      )
      assert.match(readFileSync(outside, 'utf8'), /keep/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-475 journal fail-closed', () => {
  it('does not reset cap history when the journal is oversized', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-journal-'))
    const path = join(dir, 'pending-ops.json')
    const intent: MoneyOutIntent = {
      kind: 'send',
      potId: 'pot_a',
      sourceAddress: ADDRESS,
      receiver: REGTEST,
      amountCents: 10,
      asset: 'USDB',
      network: 'MAINNET',
    }
    try {
      await beginOperation(intent, 'k1', { path, env: envIn(dir) })
      const before = readFileSync(path)
      writeFileSync(path, Buffer.alloc(MAX_JOURNAL_BYTES + 8, 0x61), { mode: 0o600 })
      await assert.rejects(
        () => beginOperation(intent, 'k2', { path, env: envIn(dir) }),
        /too large/,
      )
      const after = readFileSync(path)
      assert.equal(after.length, MAX_JOURNAL_BYTES + 8)
      assert.notEqual(after.toString('utf8').includes('"k2"'), true)
      void before
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-476 pay network and idempotency salt', () => {
  it('does not call the signer when the recipient network differs from the pot', async () => {
    let signed = false
    await assert.rejects(
      () =>
        payResourceResult('res_1', {
          env: { ZAPPI_POT_ID: 'pot_1', ZAPPI_API_URL: 'https://api.example.test', SPARK_NETWORK: 'MAINNET' },
          fetch: async () =>
            new Response(
              JSON.stringify({
                accepts: [
                  {
                    payTo: SPARKRT,
                    network: 'spark',
                    asset: 'USDB',
                    extra: { priceCents: 25, pricingMode: 'exact' },
                  },
                ],
              }),
              { status: 402, headers: { 'Content-Type': 'application/json' } },
            ),
          loadSeed: () => PHRASE,
          sendUsdb: async () => {
            signed = true
            return { sparkTxHash: 'aa'.repeat(32) }
          },
        }),
      /Recipient Spark network is REGTEST/,
    )
    assert.equal(signed, false)
  })

  it('treats a different idempotency salt as a different payment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-idem-'))
    const journal = join(dir, 'pending-ops.json')
    const hashes: string[] = []
    const base = {
      env: envIn(dir),
      kind: 'send' as const,
      receiver: REGTEST,
      amountCents: 10,
      tokenIdentifier: 'btkn1',
      journal: { path: journal, env: envIn(dir) },
      resolveContext: async () =>
        Object.freeze({
          potId: 'pot_a',
          sparkAddress: ADDRESS,
          spendMode: 'free' as const,
          network: 'MAINNET' as const,
          derivationMode: 'spark' as const,
          accountIndex: 1,
          source: 'registry' as const,
          getSeed: () => PHRASE,
        }),
      sendUsdb: async () => {
        hashes.push('signed')
        return { sparkTxHash: 'bb'.repeat(32) }
      },
    }
    try {
      await gateAndSignFreePot({ ...base, externalIdempotencyKey: 'one' })
      await gateAndSignFreePot({ ...base, externalIdempotencyKey: 'two' })
      const replay = await gateAndSignFreePot({ ...base, externalIdempotencyKey: 'one' })
      assert.equal(hashes.length, 2)
      assert.equal(replay.reconciled, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-472 child environment', () => {
  it('spawnSanitized drops the seed and passphrase from the child', async () => {
    const child = spawnSanitized(
      process.execPath,
      ['-e', 'process.stdout.write(String(process.env.ZAPPI_POT_SEED ?? "missing") + "|" + String(process.env.ZAPPI_POT_PASSPHRASE ?? "missing"))'],
      {
        env: {
          ...process.env,
          ZAPPI_POT_SEED: 'super-secret-seed',
          ZAPPI_POT_PASSPHRASE: PASSPHRASE,
        },
      },
    )
    let out = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      out += chunk
    })
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    })
    assert.equal(code, 0)
    assert.equal(out, 'missing|missing')
  })
})
