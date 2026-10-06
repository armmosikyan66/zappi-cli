import assert from 'node:assert/strict'
import { bech32m } from '@scure/base'
import { describe, it } from 'node:test'
import { classifySendTarget, runSendSparkUsdb } from './send-commands.js'
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
