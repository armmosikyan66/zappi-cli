import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canonicalIntent,
  deriveIdempotencyKey,
  intentHash,
  validateMoneyOutIntent,
  type MoneyOutIntent,
} from './pot-outgate.js'
import type { PotContext } from './pot-context.js'

function makeContext(overrides: Partial<Pick<PotContext, 'potId' | 'sparkAddress' | 'network'>> = {}): PotContext {
  const base = {
    potId: 'pot_1',
    sparkAddress: 'spark1source',
    spendMode: 'free' as const,
    network: 'REGTEST' as const,
    derivationMode: 'spark' as const,
    accountIndex: 0,
    source: 'registry' as const,
    getSeed: () => 'seed',
  }
  return Object.freeze({ ...base, ...overrides }) as PotContext
}

function payIntent(overrides: Partial<MoneyOutIntent> = {}): MoneyOutIntent {
  return {
    kind: 'pay',
    potId: 'pot_1',
    sourceAddress: 'spark1source',
    receiver: 'spark1payto',
    amountCents: 25,
    asset: 'USDB',
    network: 'REGTEST',
    resourceId: 'res_1',
    ...overrides,
  }
}

function sendIntent(overrides: Partial<MoneyOutIntent> = {}): MoneyOutIntent {
  return {
    kind: 'send',
    potId: 'pot_1',
    sourceAddress: 'spark1source',
    receiver: 'spark1friend',
    amountCents: 100,
    asset: 'USDB',
    network: 'REGTEST',
    ...overrides,
  }
}

describe('canonicalIntent + intentHash', () => {
  it('is stable under key reordering and ignores receiver whitespace', () => {
    const a = payIntent()
    const b: MoneyOutIntent = {
      kind: 'pay',
      resourceId: 'res_1',
      network: 'REGTEST',
      potId: 'pot_1',
      asset: 'USDB',
      amountCents: 25,
      sourceAddress: 'spark1source',
      receiver: '  spark1payto  ',
    }
    assert.equal(canonicalIntent(a), canonicalIntent(b))
    assert.equal(intentHash(a), intentHash(b))
  })

  it('changes when any immutable field changes', () => {
    const base = payIntent()
    assert.notEqual(intentHash(base), intentHash(payIntent({ amountCents: 26 })))
    assert.notEqual(intentHash(base), intentHash(payIntent({ receiver: 'spark1other' })))
    assert.notEqual(intentHash(base), intentHash(payIntent({ resourceId: 'res_2' })))
    assert.notEqual(intentHash(base), intentHash(payIntent({ network: 'MAINNET' })))
    assert.notEqual(intentHash(base), intentHash(payIntent({ potId: 'pot_2' })))
  })
})

describe('deriveIdempotencyKey', () => {
  it('is deterministic for the same intent', () => {
    assert.equal(deriveIdempotencyKey(payIntent()), deriveIdempotencyKey(payIntent()))
  })

  it('mixes in an external salt so retries can disambiguate without changing identity', () => {
    assert.notEqual(
      deriveIdempotencyKey(payIntent(), 'salt-a'),
      deriveIdempotencyKey(payIntent(), 'salt-b'),
    )
    assert.notEqual(
      deriveIdempotencyKey(payIntent(), 'salt-a'),
      deriveIdempotencyKey(payIntent()),
    )
  })

  it('ignores a blank/whitespace salt', () => {
    assert.equal(deriveIdempotencyKey(payIntent(), '   '), deriveIdempotencyKey(payIntent()))
  })
})

describe('validateMoneyOutIntent', () => {
  it('accepts a matching pay intent and returns a deterministic key', () => {
    const ctx = makeContext()
    const { idempotencyKey } = validateMoneyOutIntent(payIntent(), ctx)
    assert.equal(idempotencyKey, deriveIdempotencyKey(payIntent()))
  })

  it('rejects a pot id mismatch (source pot must match)', () => {
    assert.throws(
      () => validateMoneyOutIntent(payIntent({ potId: 'pot_2' }), makeContext()),
      /does not match the resolved pot/,
    )
  })

  it('rejects a network mismatch', () => {
    assert.throws(
      () => validateMoneyOutIntent(payIntent({ network: 'MAINNET' }), makeContext({ network: 'REGTEST' })),
      /does not match the pot network/,
    )
  })

  it('rejects a source address mismatch', () => {
    assert.throws(
      () => validateMoneyOutIntent(payIntent({ sourceAddress: 'spark1other' }), makeContext()),
      /does not match the pot identity/,
    )
  })

  it('rejects a non-free context', () => {
    const ctx = makeContext()
    const fake = { ...ctx, spendMode: 'auth_required' as const } as unknown as PotContext
    assert.throws(
      () => validateMoneyOutIntent(payIntent(), fake),
      /free pots only/,
    )
  })

  it('rejects a missing recipient', () => {
    assert.throws(
      () => validateMoneyOutIntent(payIntent({ receiver: '  ' }), makeContext()),
      /missing recipient/,
    )
  })

  it('rejects a non-integer or non-positive amount', () => {
    assert.throws(
      () => validateMoneyOutIntent(payIntent({ amountCents: 0 }), makeContext()),
      /positive integer/,
    )
    assert.throws(
      () => validateMoneyOutIntent(payIntent({ amountCents: 1.5 }), makeContext()),
      /positive integer/,
    )
  })

  it('rejects an unsupported asset', () => {
    assert.throws(
      () => validateMoneyOutIntent(payIntent({ asset: 'USDT' as never }), makeContext()),
      /unsupported/,
    )
  })

  it('pay requires a resource id', () => {
    assert.throws(
      () => validateMoneyOutIntent(payIntent({ resourceId: undefined }), makeContext()),
      /missing resource id/,
    )
  })

  it('send must not carry a resource id', () => {
    assert.throws(
      () => validateMoneyOutIntent(sendIntent({ resourceId: 'res_1' }), makeContext()),
      /must not carry a resource id/,
    )
  })

  it('rejects an expired quote', () => {
    assert.throws(
      () =>
        validateMoneyOutIntent(sendIntent({ quoteExpiryMs: 1000 }), makeContext(), { now: () => 2000 }),
      /Quote has expired/,
    )
  })

  it('accepts an unexpired quote', () => {
    const { idempotencyKey } = validateMoneyOutIntent(
      sendIntent({ quoteExpiryMs: 10_000 }),
      makeContext(),
      { now: () => 5_000 },
    )
    assert.equal(idempotencyKey, deriveIdempotencyKey(sendIntent({ quoteExpiryMs: 10_000 })))
  })

  it('binds an external idempotency salt into the key', () => {
    const { idempotencyKey } = validateMoneyOutIntent(payIntent(), makeContext(), {
      externalIdempotencyKey: 'caller-salt',
    })
    assert.equal(idempotencyKey, deriveIdempotencyKey(payIntent(), 'caller-salt'))
  })
})
