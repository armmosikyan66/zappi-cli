/**
 * Regressions for the 1-481 review (Linear 1-482). No live transfers.
 */

import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { bech32m } from '@scure/base'
import { runPotBind } from './bind-commands.js'
import { parsePayCliArgs } from './cli.js'
import { gateAndSignFreePot } from './free-pot-sign.js'
import { payResourceResult } from './paywall.js'
import type { PotContext } from './pot-context.js'
import {
  listPots,
  loadPotSeedFromRegistry,
  MAX_REGISTRY_FILE_BYTES,
  savePotSeed,
} from './pot-registry.js'
import {
  runPotsRegistryBackup,
  runPotsRegistryImport,
  runPotsRegistryRestore,
} from './pots-registry-commands.js'
import { selectCanonicalUsdbToken } from './spark-send.js'
import { runSend } from './send-commands.js'
import { runWithdrawConfirm } from './withdraw-commands.js'

const PHRASE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
const PHRASE_B =
  'mango nectar olive papaya quince radish savory thyme umber violet walnut'
const PASSPHRASE = 'a-very-long-high-entropy-host-secret-passphrase-0123456789'
const ADDRESS = 'spark1exampleaddress0000000000000000'
const ADDRESS_B = 'spark1otheridentity00000000000000000'
const REGTEST = bech32m.encode('sparkrt', bech32m.toWords(new Uint8Array(32).fill(4)))
const POT = '11111111-1111-4111-8111-111111111111'

function envIn(dir: string) {
  return {
    ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
    ZAPPI_POT_PENDING_OPS_FILE: join(dir, 'pending-ops.json'),
    ZAPPI_API_URL: 'https://api.test.zappi.money',
    ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
    ZAPPI_POT_PASSPHRASE: PASSPHRASE,
    SPARK_NETWORK: 'REGTEST',
  }
}

async function seal(
  env: ReturnType<typeof envIn>,
  potId: string,
  sparkAddress = ADDRESS,
  seed = PHRASE,
) {
  await savePotSeed(
    {
      potId,
      sparkAddress,
      spendMode: 'free',
      network: 'REGTEST',
      derivationMode: 'spark',
      accountIndex: 0,
      seed,
    },
    PASSPHRASE,
    { env },
  )
}

function context(potId: string, sparkAddress = REGTEST): PotContext {
  return {
    potId,
    sparkAddress,
    spendMode: 'free',
    network: 'REGTEST',
    derivationMode: 'spark',
    accountIndex: 0,
    source: 'registry',
    getSeed: () => PHRASE,
  }
}

describe('1-485 routed send keeps the explicit pot', () => {
  it('fails closed when --pot and ZAPPI_POT_ID disagree, on every route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-pot-flag-'))
    const env = { ...envIn(dir), ZAPPI_POT_ID: 'pot_a' }
    try {
      await seal(env, 'pot_a')
      await seal(env, 'pot_b', ADDRESS_B)
      const hooks = {
        deriveAddress: async () => ADDRESS,
        onContext: () => {
          throw new Error('signed after a conflict')
        },
      }
      const cases: Array<() => Promise<string>> = [
        () => runSend(['--to', '@bob', '--amount-cents', '10', '--pot', 'pot_b'], 'plain', env, hooks),
        () =>
          runSend(
            ['--to', 'addr', '--amount-cents', '10', '--asset', 'USDC', '--network', 'solana', '--pot', 'pot_b'],
            'plain',
            env,
            hooks,
          ),
        () => runSend(['--to', REGTEST, '--amount-cents', '10', '--pot', 'pot_b'], 'plain', env, hooks),
        () => runWithdrawConfirm(['quote_1', '--pot', 'pot_b'], 'plain', env, hooks),
      ]
      for (const run of cases) {
        await assert.rejects(run, /Conflicting pot selectors/)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses --pot B when the environment pot id is unset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-pot-b-'))
    const env = envIn(dir)
    try {
      await seal(env, 'pot_a')
      await seal(env, 'pot_b', ADDRESS_B)
      const seen: string[] = []
      const hooks = {
        deriveAddress: async (_seed: string, _network: 'MAINNET' | 'REGTEST', _index: number) => ADDRESS_B,
        onContext: (ctx: PotContext) => {
          seen.push(ctx.potId)
          throw new Error('stop before network')
        },
      }
      const cases: Array<() => Promise<string>> = [
        () => runSend(['--to', '@bob', '--amount-cents', '10', '--pot', 'pot_b'], 'plain', env, hooks),
        () =>
          runSend(
            ['--to', 'addr', '--amount-cents', '10', '--asset', 'USDC', '--network', 'solana', '--pot', 'pot_b'],
            'plain',
            env,
            hooks,
          ),
        () => runSend(['--to', REGTEST, '--amount-cents', '10', '--pot', 'pot_b'], 'plain', env, hooks),
        () => runWithdrawConfirm(['quote_1', '--pot', 'pot_b'], 'plain', env, hooks),
      ]
      for (const run of cases) {
        await assert.rejects(run, /stop before network/)
      }
      assert.deepEqual(seen, ['pot_b', 'pot_b', 'pot_b', 'pot_b'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-486 import identity is locked with the write', () => {
  it('lets only one of two different identities win', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-import-race-'))
    const env = envIn(dir)
    const deriveAddress = async (seed: string) => {
      await new Promise((resolve) => setTimeout(resolve, 40))
      return seed === PHRASE ? ADDRESS : ADDRESS_B
    }
    const args = (address: string) => [
      '--pot-id',
      'pot_a',
      '--network',
      'REGTEST',
      '--account-index',
      '0',
      '--address',
      address,
    ]
    try {
      const results = await Promise.allSettled([
        runPotsRegistryImport(args(ADDRESS), 'plain', {
          env,
          deriveAddress,
          askSecret: async () => PHRASE,
        }),
        runPotsRegistryImport(args(ADDRESS_B), 'plain', {
          env,
          deriveAddress,
          askSecret: async () => PHRASE_B,
        }),
      ])
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
      const loaded = await loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env })
      if (loaded.seed === PHRASE) assert.equal(loaded.record.sparkAddress, ADDRESS)
      else {
        assert.equal(loaded.seed, PHRASE_B)
        assert.equal(loaded.record.sparkAddress, ADDRESS_B)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-487 restore checks the derived address', () => {
  it('rejects an authentic backup whose seed does not match the stored address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-restore-id-'))
    const env = envIn(dir)
    try {
      await seal(env, 'pot_live', ADDRESS)
      const live = readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')
      const claimed = mkdtempSync(join(tmpdir(), 'zappi-claimed-'))
      const claimedEnv = envIn(claimed)
      await seal(claimedEnv, 'pot_bad', ADDRESS_B, PHRASE)
      const backup = join(dir, 'backup.json')
      await runPotsRegistryBackup([backup], 'plain', { env: claimedEnv })
      const backupBytes = readFileSync(backup)
      await assert.rejects(
        () =>
          runPotsRegistryRestore([backup], 'plain', {
            env,
            deriveAddress: async () => ADDRESS,
          }),
        /does not derive/,
      )
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8'), live)
      assert.deepEqual(readFileSync(backup), backupBytes)
      const still = await loadPotSeedFromRegistry('pot_live', PASSPHRASE, { env })
      assert.equal(still.seed, PHRASE)
      rmSync(claimed, { recursive: true, force: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-488 quote expiry and 1-490 pre-broadcast recovery', () => {
  it('does not sign when the quote expires during token lookup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-expiry-'))
    const env = envIn(dir)
    let now = 1_000
    let sends = 0
    try {
      await assert.rejects(
        () =>
          gateAndSignFreePot({
            env,
            kind: 'send',
            receiver: REGTEST,
            amountCents: 25,
            quoteExpiryMs: 5_000,
            requireQuoteExpiry: true,
            now: () => now,
            journal: { env },
            resolveContext: async () => context('pot_a'),
            readTokenIdentifier: async () => {
              now = 9_000
              return 'btkn1usdb'
            },
            sendUsdb: async () => {
              sends += 1
              return { sparkTxHash: 'aa'.repeat(32) }
            },
          }),
        /expired/,
      )
      assert.equal(sends, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reconciles a submitted hash after the quote expires', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-reconcile-'))
    const env = envIn(dir)
    let now = 1_000
    let sends = 0
    const hash = 'bb'.repeat(32)
    const input = {
      env,
      kind: 'send' as const,
      receiver: REGTEST,
      amountCents: 25,
      quoteExpiryMs: 5_000,
      requireQuoteExpiry: true,
      externalIdempotencyKey: 'quote-1',
      now: () => now,
      journal: { env },
      resolveContext: async () => context('pot_a'),
      readTokenIdentifier: async () => 'btkn1usdb',
      sendUsdb: async () => {
        sends += 1
        return { sparkTxHash: hash }
      },
    }
    try {
      const first = await gateAndSignFreePot(input)
      now = 9_000
      const retry = await gateAndSignFreePot(input)
      assert.equal(sends, 1)
      assert.equal(retry.sparkTxHash, first.sparkTxHash)
      assert.equal(retry.reconciled, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('retries after a token lookup failure and does not re-sign an unknown broadcast', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-journal-retry-'))
    const env = envIn(dir)
    let lookups = 0
    let sends = 0
    const base = {
      env,
      kind: 'send' as const,
      receiver: REGTEST,
      amountCents: 25,
      externalIdempotencyKey: 'same',
      journal: { env },
      resolveContext: async () => context('pot_a'),
    }
    try {
      await assert.rejects(
        () =>
          gateAndSignFreePot({
            ...base,
            readTokenIdentifier: async () => {
              lookups += 1
              throw new Error('token lookup failed')
            },
            sendUsdb: async () => {
              sends += 1
              return { sparkTxHash: 'cc'.repeat(32) }
            },
          }),
        /token lookup failed/,
      )
      assert.equal(sends, 0)
      const ok = await gateAndSignFreePot({
        ...base,
        readTokenIdentifier: async () => 'btkn1usdb',
        sendUsdb: async () => {
          sends += 1
          return { sparkTxHash: 'dd'.repeat(32) }
        },
      })
      assert.equal(ok.sparkTxHash, 'dd'.repeat(32))
      assert.equal(sends, 1)

      await assert.rejects(
        () =>
          gateAndSignFreePot({
            ...base,
            externalIdempotencyKey: 'broadcast-unknown',
            readTokenIdentifier: async () => 'btkn1usdb',
            sendUsdb: async () => {
              sends += 1
              throw new Error('signer timeout')
            },
          }),
        /signer timeout/,
      )
      const before = sends
      await assert.rejects(
        () =>
          gateAndSignFreePot({
            ...base,
            externalIdempotencyKey: 'broadcast-unknown',
            readTokenIdentifier: async () => 'btkn1usdb',
            sendUsdb: async () => {
              sends += 1
              return { sparkTxHash: 'ee'.repeat(32) }
            },
          }),
        /unknown state/,
      )
      assert.equal(sends, before)
      assert.ok(lookups >= 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-489 backup size and label bounds', () => {
  it('restores a backup larger than 64 KiB and refuses an oversized file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-size-'))
    const env = {
      ...envIn(dir),
      ZAPPI_API_URL: `https://api.test.zappi.money/${'a'.repeat(900)}`,
      ZAPPI_APP_ORIGIN: `https://app.test.zappi.money/${'b'.repeat(900)}`,
    }
    try {
      for (let index = 0; index < 46; index += 1) {
        await seal(env, `pot_${index}`)
      }
      const backup = join(dir, 'backup.json')
      await runPotsRegistryBackup([backup], 'plain', { env })
      const size = statSync(backup).size
      assert.ok(size > 65_536, `backup was ${size} bytes`)
      assert.ok(size <= MAX_REGISTRY_FILE_BYTES)
      const live = readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')
      const huge = join(dir, 'huge.json')
      writeFileSync(huge, Buffer.alloc(MAX_REGISTRY_FILE_BYTES + 1, 0x61), { mode: 0o600 })
      chmodSync(huge, 0o600)
      await assert.rejects(() => runPotsRegistryRestore([huge], 'plain', { env }), /larger than/)
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8'), live)
      await runPotsRegistryRestore([backup], 'plain', {
        env,
        deriveAddress: async () => ADDRESS,
      })
      const loaded = await loadPotSeedFromRegistry('pot_0', PASSPHRASE, { env })
      assert.equal(loaded.seed, PHRASE)
      assert.equal((await listPots({ env })).length, 46)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a 257-character label and keeps the previous registry readable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-label-'))
    const env = envIn(dir)
    try {
      await savePotSeed(
        {
          potId: 'pot_a',
          label: 'a'.repeat(256),
          sparkAddress: ADDRESS,
          spendMode: 'free',
          network: 'REGTEST',
          derivationMode: 'spark',
          accountIndex: 0,
          seed: PHRASE,
        },
        PASSPHRASE,
        { env },
      )
      const before = readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')
      await assert.rejects(
        () =>
          savePotSeed(
            {
              potId: 'pot_b',
              label: 'b'.repeat(257),
              sparkAddress: ADDRESS_B,
              spendMode: 'free',
              network: 'REGTEST',
              derivationMode: 'spark',
              accountIndex: 0,
              seed: PHRASE_B,
            },
            PASSPHRASE,
            { env },
          ),
        /too long/,
      )
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8'), before)
      const pots = await listPots({ env })
      assert.equal(pots.length, 1)
      assert.equal(pots[0]?.label?.length, 256)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-491 pots bind does not replace a sealed seed', () => {
  it('reuses the sealed address across repeat, rejection, and interruption', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-bind-'))
    const env = { ...envIn(dir), ZAPPI_HOME: dir }
    let generated = 0
    let creates = 0
    const client = {
      previewPotAttach: async () => ({ exists: true, bindable: true, status: 'pending', spendMode: 'free' }),
      createPotAttach: async (input: { sparkAddress: string }) => {
        creates += 1
        if (creates === 1) throw new Error('interrupted')
        return {
          approveUrl: 'https://app.test.zappi.money/approve',
          requestId: 'req_1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          sparkAddress: input.sparkAddress,
        }
      },
      pollPotAttach: async () => ({ status: 'rejected', potId: POT, grantId: null }),
    }
    const deps = {
      client,
      generateMnemonic: () => {
        generated += 1
        return PHRASE
      },
      deriveSparkAddress: async () => ADDRESS,
    }
    try {
      await assert.rejects(
        () => runPotBind([POT, '--no-poll'], 'plain', env, deps),
        /interrupted/,
      )
      const sealed = readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8')
      assert.equal(generated, 1)
      await runPotBind([POT, '--no-poll'], 'plain', env, deps)
      assert.equal(generated, 1)
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8'), sealed)
      const loaded = await loadPotSeedFromRegistry(POT, PASSPHRASE, { env })
      assert.equal(loaded.seed, PHRASE)
      assert.equal(loaded.record.sparkAddress, ADDRESS)
      await runPotBind([POT], 'plain', env, deps)
      assert.equal(generated, 1)
      assert.equal(readFileSync(env.ZAPPI_POT_REGISTRY_FILE, 'utf8'), sealed)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-492 canonical USDB stops a bad balance before signing', () => {
  it('does not sign an unrelated btkn token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-usdb-'))
    const env = envIn(dir)
    let sends = 0
    try {
      await assert.rejects(
        () =>
          gateAndSignFreePot({
            env,
            kind: 'send',
            receiver: REGTEST,
            amountCents: 25,
            journal: { env },
            resolveContext: async () => context('pot_a'),
            readTokenIdentifier: async () =>
              selectCanonicalUsdbToken(
                {
                  btkn1other: { tokenMetadata: { tokenTicker: 'OTHER', decimals: 8 } },
                  btkn1bare: { ownedBalance: '1' },
                },
                'REGTEST',
              ),
            sendUsdb: async () => {
              sends += 1
              return { sparkTxHash: 'ff'.repeat(32) }
            },
          }),
        /canonical USDB/,
      )
      assert.equal(sends, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-493 pay threads the idempotency salt', () => {
  it('parses --idempotency-key', () => {
    const parsed = parsePayCliArgs(['res_1', '--idempotency-key', 'salt-a', '--pot', 'pot_b'])
    assert.equal(parsed.idempotencyKey, 'salt-a')
    assert.equal(parsed.potFlag, 'pot_b')
  })

  it('reconciles the same salt and signs again for a different salt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-pay-salt-'))
    const env = {
      ...envIn(dir),
      ZAPPI_POT_ID: 'pot_1',
    }
    let sends = 0
    const fetchMock: typeof fetch = async (_input, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return new Response(
          JSON.stringify({
            accepts: [
              {
                payTo: REGTEST,
                network: 'spark',
                asset: 'USDB',
                extra: { priceCents: 25, pricingMode: 'exact' },
              },
            ],
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ firstUnlock: true, unlockToken: 'zpu_secret' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const pay = (salt: string) =>
      payResourceResult('res_1', {
        env,
        fetch: fetchMock,
        loadSeed: () => PHRASE,
        journal: { env },
        externalIdempotencyKey: salt,
        readTokenIdentifier: async () => 'btkn1example',
        sendUsdb: async () => {
          sends += 1
          return { sparkTxHash: `${sends}`.repeat(64).slice(0, 64) }
        },
      })
    try {
      const first = await pay('salt-a')
      const replay = await pay('salt-a')
      const other = await pay('salt-b')
      assert.equal(sends, 2)
      if (!first.ok || first.status !== 'settled' || !replay.ok || !other.ok || other.status !== 'settled') {
        throw new Error('expected settled pay results')
      }
      assert.equal(replay.status, 'settled')
      assert.notEqual(other.sparkTxHash, first.sparkTxHash)
      await assert.rejects(
        () =>
          payResourceResult('res_1', {
            env: { ...env, ZAPPI_POT_ID: 'pot_a' },
            potFlag: 'pot_b',
            fetch: fetchMock,
            loadSeed: () => PHRASE,
            sendUsdb: async () => {
              sends += 1
              return { sparkTxHash: '11'.repeat(32) }
            },
          }),
        /Conflicting pot selectors/,
      )
      assert.equal(sends, 2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('auth-required pots stay out of the free signer', () => {
  it('rejects auth_required before a signer call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-auth-'))
    const env = { ...envIn(dir), ZAPPI_POT_SPEND_MODE: 'auth_required' }
    let sends = 0
    try {
      await assert.rejects(
        () =>
          gateAndSignFreePot({
            env,
            kind: 'send',
            receiver: REGTEST,
            amountCents: 25,
            resolveContext: async () => context('pot_a'),
            sendUsdb: async () => {
              sends += 1
              return { sparkTxHash: '11'.repeat(32) }
            },
          }),
        /auth.required|Auth-required/i,
      )
      assert.equal(sends, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
