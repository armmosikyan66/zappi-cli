import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bech32m } from '@scure/base'
import { describe, it } from 'node:test'
import { classifySendTarget, runSendSparkUsdb } from './send-commands.js'
import type { JournalDeps } from './pending-ops.js'
import type { PotContext } from './pot-context.js'

function fakeContext(overrides: Partial<Pick<PotContext, 'potId' | 'sparkAddress' | 'network' | 'accountIndex'>> = {}): PotContext {
  return Object.freeze({
    potId: 'pot_1',
    sparkAddress: 'spark1source',
    spendMode: 'free' as const,
    network: 'MAINNET' as const,
    derivationMode: 'spark' as const,
    accountIndex: 1,
    source: 'registry' as const,
    getSeed: () => 'seed',
    ...overrides,
  }) as PotContext
}

describe('classifySendTarget', () => {
  it('routes @user to internal', () => {
    assert.equal(classifySendTarget('@alice', {}), 'internal')
  })

  it('routes bare id without asset/network to internal', () => {
    assert.equal(classifySendTarget('user_123', {}), 'internal')
  })

  it('routes sparkrt1… to spark (not internal UUID)', () => {
    assert.equal(
      classifySendTarget(
        'sparkrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6h4k8p',
        {},
      ),
      'spark',
    )
  })

  it('routes spark1… to spark even when asset flags present', () => {
    assert.equal(
      classifySendTarget('spark1qabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrs', {
        asset: 'usdc',
        network: 'spark',
      }),
      'spark',
    )
  })

  it('routes address with asset+network to external', () => {
    assert.equal(
      classifySendTarget('0xabc', { asset: 'usdc', network: 'base' }),
      'external',
    )
  })

  it('routes asset without network as external (caller must supply network)', () => {
    assert.equal(classifySendTarget('bc1qabc', { asset: 'btc' }), 'external')
  })
})

describe('runSendSparkUsdb pre-sign gate', () => {
  // Valid MAINNET spark address (bech32m, HRP spark).
  const MAINNET_ADDR =
    'spark1pgssyele0qrcjdheeq2a0zmpwdwvj3r4f4stkuju0fp36g6grapv2w7l8am2cp'

  it('rejects a regtest receiver before signing (no SDK call)', async () => {
    const regtest = bech32m.encode('sparkrt', bech32m.toWords(new Uint8Array(32).fill(4)))
    await assert.rejects(
      () =>
        runSendSparkUsdb(
          regtest,
          100,
          'plain',
          { ZAPPI_POT_ID: 'pot_1' },
          () => Promise.resolve(fakeContext()),
        ),
      /Spark address network is REGTEST but the pot network is MAINNET/,
    )
  })
})

describe('runSendSparkUsdb journal', () => {
  const RECEIVER = bech32m.encode('spark', bech32m.toWords(new Uint8Array(32).fill(9)))
  const HASH = 'ab'.repeat(32)

  function journalIn(dir: string, extra: JournalDeps['env'] = {}): JournalDeps {
    const path = join(dir, 'pending-ops.json')
    return { path, env: { ZAPPI_POT_PENDING_OPS_FILE: path, ...extra } }
  }

  function mockedSigner(onSign: () => void) {
    return {
      readTokenIdentifier: async () => 'btkn1usdb',
      sendUsdb: async () => {
        onSign()
        return { sparkTxHash: HASH }
      },
    }
  }

  it('reconciles a journaled hash without signing again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-spark-replay-'))
    const jdeps = journalIn(dir)
    let signs = 0
    const signer = mockedSigner(() => {
      signs += 1
    })
    const send = () =>
      runSendSparkUsdb(
        RECEIVER,
        25,
        'json',
        {},
        async () => fakeContext(),
        jdeps,
        undefined,
        signer,
      )
    try {
      const first = JSON.parse(await send()) as { sparkTxHash: string; reconciled: boolean }
      const second = JSON.parse(await send()) as { sparkTxHash: string; reconciled: boolean }
      assert.equal(signs, 1)
      assert.equal(first.reconciled, false)
      assert.equal(first.sparkTxHash, HASH)
      assert.equal(second.reconciled, true)
      assert.equal(second.sparkTxHash, HASH)
      const file = JSON.parse(readFileSync(jdeps.path!, 'utf8')) as {
        ops: Record<string, { status: string; sparkTxHash?: string; amountCents: number }>
      }
      const ops = Object.values(file.ops)
      assert.equal(ops.length, 1)
      assert.equal(ops[0]?.status, 'settled')
      assert.equal(ops[0]?.sparkTxHash, HASH)
      assert.equal(ops[0]?.amountCents, 25)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('enforces the per-payment cap before signing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-spark-cap-'))
    const jdeps = journalIn(dir, { ZAPPI_POT_MAX_PER_PAYMENT_CENTS: '50' })
    let signs = 0
    try {
      await assert.rejects(
        () =>
          runSendSparkUsdb(
            RECEIVER,
            100,
            'json',
            {},
            async () => fakeContext(),
            jdeps,
            undefined,
            mockedSigner(() => {
              signs += 1
            }),
          ),
        /exceeds the per-payment cap/,
      )
      assert.equal(signs, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
