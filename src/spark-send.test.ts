import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  pickUsdbTokenIdentifier,
  tokenBalanceEntries,
} from './spark-send.js'

describe('pickUsdbTokenIdentifier', () => {
  it('reads btkn keys from a plain object', () => {
    assert.equal(
      pickUsdbTokenIdentifier({
        btkn1abc: { availableToSendBalance: '1' },
        other: { availableToSendBalance: '2' },
      }),
      'btkn1abc',
    )
  })

  it('reads btkn keys from a Spark Map (REGTEST/MAINNET)', () => {
    const balances = new Map<string, { availableToSendBalance: string }>([
      ['btkn1map', { availableToSendBalance: '5000000' }],
    ])
    assert.equal(pickUsdbTokenIdentifier(balances), 'btkn1map')
  })

  it('returns null when Object.keys would see an empty Map', () => {
    const balances = new Map([['btkn1hidden', { availableToSendBalance: '1' }]])
    assert.equal(Object.keys(balances).length, 0)
    assert.equal(pickUsdbTokenIdentifier(balances), 'btkn1hidden')
  })

  it('returns null for empty or non-object input', () => {
    assert.equal(pickUsdbTokenIdentifier(null), null)
    assert.equal(pickUsdbTokenIdentifier({}), null)
    assert.equal(pickUsdbTokenIdentifier(new Map()), null)
  })
})

describe('tokenBalanceEntries', () => {
  it('normalizes Map and record to string entries', () => {
    const fromMap = tokenBalanceEntries(new Map([['btkn1', { a: 1 }]]))
    assert.deepEqual(fromMap, [['btkn1', { a: 1 }]])
    const fromObj = tokenBalanceEntries({ btkn1: { a: 1 } })
    assert.deepEqual(fromObj, [['btkn1', { a: 1 }]])
  })
})
