import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { writePotClientTokenFile } from './attach-device-secret.js'
import {
  DEFAULT_ZAPPI_API_URL,
  DEFAULT_ZAPPI_APP_ORIGIN,
  POT_NOT_ATTACHED_ERROR,
  STAGING_ZAPPI_API_URL,
  parsePositiveUnits,
  requireAuthRequiredPotAttached,
  requirePotId,
  relocateAppLink,
  resolveAppOrigin,
  resolveLinkOrigin,
  resolvePaywallBase,
  resolvePotClientToken,
  resolvePotSpendMode,
  resolveSparkNetwork,
  resolveUnlockToken,
} from './env.js'

describe('resolvePaywallBase', () => {
  it('defaults to the dev API', () => {
    assert.equal(resolvePaywallBase({}), DEFAULT_ZAPPI_API_URL)
    assert.equal(DEFAULT_ZAPPI_API_URL, 'https://api-dev.zappi.money')
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
  it('defaults app origin to the dev web app', () => {
    assert.equal(resolveAppOrigin({}), DEFAULT_ZAPPI_APP_ORIGIN)
    assert.equal(DEFAULT_ZAPPI_APP_ORIGIN, 'https://dev.zappi.money')
  })

  it('pairs links with the API and keeps an explicit app origin', () => {
    assert.equal(resolveLinkOrigin({}), 'https://dev.zappi.money')
    assert.equal(
      resolveLinkOrigin({ ZAPPI_API_URL: 'https://api-dev.zappi.money' }),
      'https://dev.zappi.money',
    )
    assert.equal(
      resolveLinkOrigin({ ZAPPI_API_URL: 'https://api.zappi.money' }),
      'https://zappi.money',
    )
    assert.equal(
      resolveLinkOrigin({ ZAPPI_API_URL: 'http://127.0.0.1:3011' }),
      'http://localhost:3000',
    )
    assert.equal(
      resolveLinkOrigin({ ZAPPI_API_URL: 'http://localhost:3011' }),
      'http://localhost:3000',
    )
    assert.equal(
      resolveLinkOrigin({
        ZAPPI_API_URL: 'https://api-dev.zappi.money',
        ZAPPI_APP_ORIGIN: 'http://localhost:3000',
      }),
      'http://localhost:3000',
    )
    assert.equal(
      relocateAppLink(
        'https://zappi.money/?panel=pots&attach=req_1',
        'https://dev.zappi.money',
      ),
      'https://dev.zappi.money/?panel=pots&attach=req_1',
    )
  })

  it('defaults spark network to REGTEST and treats MAINNET as explicit', () => {
    assert.equal(resolveSparkNetwork({}), 'REGTEST')
    assert.equal(resolveSparkNetwork({ SPARK_NETWORK: 'regtest' }), 'REGTEST')
    assert.equal(resolveSparkNetwork({ SPARK_NETWORK: 'mainnet' }), 'MAINNET')
  })

  it('parses positive consume/pay units', () => {
    assert.equal(parsePositiveUnits(undefined), 1)
    assert.equal(parsePositiveUnits('3'), 3)
    assert.throws(() => parsePositiveUnits('0'), /positive integer/)
  })

  it('requires a zpc_ pot client token and never echoes a bad value', () => {
    const emptyHome = mkdtempSync(join(tmpdir(), 'zappi-cli-empty-'))
    assert.equal(
      resolvePotClientToken({ ZAPPI_POT_CLIENT_TOKEN: 'zpc_live' }),
      'zpc_live',
    )
    assert.throws(
      () => resolvePotClientToken({ ZAPPI_HOME: emptyHome }),
      /not attached/,
    )
    assert.throws(
      () => resolvePotClientToken({ ZAPPI_HOME: emptyHome }),
      /pots attach/,
    )
    assert.throws(
      () => resolvePotClientToken({ ZAPPI_HOME: emptyHome }),
      /Do not ask for a zpc_/,
    )
    assert.throws(
      () => resolvePotClientToken({ ZAPPI_POT_CLIENT_TOKEN: '<zpc_…>' }),
      /placeholder/,
    )
    assert.throws(
      () =>
        resolvePotClientToken({
          ZAPPI_POT_CLIENT_TOKEN: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.',
        }),
      (error: Error) => {
        assert.match(error.message, /pot client token/)
        assert.doesNotMatch(error.message, /eyJ/)
        return true
      },
    )
  })

  it('treats a stored attach token as attached and does not ask to paste zpc_', () => {
    const home = mkdtempSync(join(tmpdir(), 'zappi-cli-attached-'))
    writePotClientTokenFile('req_1', 'zpc_fromfile', { ZAPPI_HOME: home })
    assert.equal(resolvePotClientToken({ ZAPPI_HOME: home }), 'zpc_fromfile')
    assert.equal(
      resolvePotClientToken({
        ZAPPI_HOME: home,
        ZAPPI_POT_CLIENT_TOKEN: 'zpc_env',
      }),
      'zpc_env',
    )
  })

  it('blocks auth-required consume/invite until attach, and skips free pots', () => {
    const emptyHome = mkdtempSync(join(tmpdir(), 'zappi-cli-gate-'))
    requireAuthRequiredPotAttached({ ZAPPI_HOME: emptyHome })
    requireAuthRequiredPotAttached({
      ZAPPI_POT_SPEND_MODE: 'auth_required',
      ZAPPI_POT_CLIENT_TOKEN: 'zpc_live',
    })
    assert.throws(
      () =>
        requireAuthRequiredPotAttached({
          ZAPPI_HOME: emptyHome,
          ZAPPI_POT_SPEND_MODE: 'auth_required',
        }),
      new RegExp(
        POT_NOT_ATTACHED_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    )
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
