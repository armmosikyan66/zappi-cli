import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_ZAPPI_API_URL,
  DEFAULT_ZAPPI_APP_ORIGIN,
  STAGING_ZAPPI_API_URL,
  parsePositiveUnits,
  requirePotId,
  resolveAppOrigin,
  resolvePaywallBase,
  resolvePotSpendMode,
  resolveSparkNetwork,
  resolveUnlockToken,
} from './env.js'

describe('resolvePaywallBase', () => {
  it('defaults to production nest', () => {
    assert.equal(resolvePaywallBase({}), DEFAULT_ZAPPI_API_URL)
  })

  it('prefers ZAPPI_PAYWALL_BASE over ZAPPI_API_URL and strips trailing slashes', () => {
    assert.equal(
      resolvePaywallBase({
        ZAPPI_PAYWALL_BASE: 'https://api-dev.zappi.money/',
        ZAPPI_API_URL: 'https://api.zappi.money',
      }),
      STAGING_ZAPPI_API_URL,
    )
  })

  it('uses ZAPPI_API_URL when paywall base is unset', () => {
    assert.equal(
      resolvePaywallBase({ ZAPPI_API_URL: 'https://api-dev.zappi.money' }),
      STAGING_ZAPPI_API_URL,
    )
  })
})

describe('resolveUnlockToken', () => {
  it('prefers env over --unlock-token so scripts can keep the flag off the command line', () => {
    assert.equal(
      resolveUnlockToken(
        { ZAPPI_UNLOCK_TOKEN: 'zpu_from_env' },
        'zpu_from_flag',
      ),
      'zpu_from_env',
    )
  })

  it('falls back to the flag when env is empty', () => {
    assert.equal(resolveUnlockToken({}, 'zpu_from_flag'), 'zpu_from_flag')
  })

  it('rejects missing and placeholder tokens without echoing them', () => {
    assert.throws(() => resolveUnlockToken({}), /ZAPPI_UNLOCK_TOKEN/)
    assert.throws(
      () => resolveUnlockToken({ ZAPPI_UNLOCK_TOKEN: '<zpu_…>' }),
      /placeholder/,
    )
  })
})

describe('resolveAppOrigin + spark network + units', () => {
  it('defaults app origin to production web', () => {
    assert.equal(resolveAppOrigin({}), DEFAULT_ZAPPI_APP_ORIGIN)
  })

  it('treats REGTEST as the only non-mainnet spark network', () => {
    assert.equal(resolveSparkNetwork({}), 'MAINNET')
    assert.equal(resolveSparkNetwork({ SPARK_NETWORK: 'regtest' }), 'REGTEST')
  })

  it('parses positive consume/pay units', () => {
    assert.equal(parsePositiveUnits(undefined), 1)
    assert.equal(parsePositiveUnits('3'), 3)
    assert.throws(() => parsePositiveUnits('0'), /positive integer/)
  })

  it('defaults spend mode to free and treats auth_required as a pay gate', () => {
    assert.equal(resolvePotSpendMode({}), 'free')
    assert.equal(
      resolvePotSpendMode({ ZAPPI_POT_SPEND_MODE: 'auth_required' }),
      'auth_required',
    )
  })

  it('requires a runtime pot id (install args are not a pot id)', () => {
    assert.throws(() => requirePotId({}), /ZAPPI_POT_ID/)
    assert.equal(requirePotId({ ZAPPI_POT_ID: 'pot_live' }), 'pot_live')
  })
})
