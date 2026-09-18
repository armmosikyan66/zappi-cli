import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PAYABLE_PAYWALL_ASSET,
  PAYABLE_PAYWALL_NETWORK,
  isMeteredPricing,
  pickPaywallAccept,
} from './paywall-accept.js'

const sparkUsdb = {
  payTo: 'spark1payto',
  network: 'spark',
  asset: 'USDB',
  extra: { priceCents: 25, pricingMode: 'exact' as const },
}

describe('pickPaywallAccept', () => {
  it('requires nest network + asset and returns the Spark USDB rail', () => {
    const selected = pickPaywallAccept({ accepts: [sparkUsdb] })
    assert.equal(selected.payTo, 'spark1payto')
    assert.equal(selected.priceCents, 25)
    assert.equal(selected.network, PAYABLE_PAYWALL_NETWORK)
    assert.equal(selected.asset, PAYABLE_PAYWALL_ASSET)
  })

  it('accepts case-insensitive spark/USDB from 402', () => {
    const selected = pickPaywallAccept({
      accepts: [{ ...sparkUsdb, network: 'Spark', asset: 'usdb' }],
    })
    assert.equal(selected.network, 'spark')
    assert.equal(selected.asset, 'USDB')
  })

  it('fails closed when network is missing (does not infer from payTo)', () => {
    assert.throws(
      () =>
        pickPaywallAccept({
          accepts: [
            { payTo: 'spark1payto', extra: { priceCents: 10 } },
          ],
        }),
      /missing accepts\[0\]\.network/,
    )
  })

  it('fails closed when asset is missing', () => {
    assert.throws(
      () =>
        pickPaywallAccept({
          accepts: [
            {
              payTo: 'spark1payto',
              network: 'spark',
              extra: { priceCents: 10 },
            },
          ],
        }),
      /missing accepts\[0\]\.asset/,
    )
  })

  it('refuses a different chain even when payTo looks like Spark', () => {
    assert.throws(
      () =>
        pickPaywallAccept({
          accepts: [
            {
              payTo: 'spark1payto',
              network: 'base',
              asset: 'USDC',
              extra: { priceCents: 10 },
            },
          ],
        }),
      /base\/USDC/,
    )
  })

  it('refuses CAIP-2 EVM rails this CLI cannot pay', () => {
    assert.throws(
      () =>
        pickPaywallAccept({
          accepts: [
            {
              payTo: '0xabc',
              network: 'eip155:8453',
              asset: 'USDC',
              extra: { priceCents: 10 },
            },
          ],
        }),
      /eip155:8453\/USDC/,
    )
  })
})

describe('isMeteredPricing', () => {
  it('treats pricingMode metered and metered_grant unlock as metered', () => {
    assert.equal(isMeteredPricing({ extra: { pricingMode: 'metered' } }), true)
    assert.equal(
      isMeteredPricing({ extra: { unlockMode: 'metered_grant' } }),
      true,
    )
    assert.equal(isMeteredPricing({ extra: { pricingMode: 'exact' } }), false)
  })
})
