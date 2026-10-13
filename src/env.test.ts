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
  resolvePotPassphrase,
  resolveSparkNetwork,
  resolveUnlockToken,
  wantsPotKeychain,
  KEYCHAIN_OPERATION_FAILED_ERROR,
  KEYCHAIN_SECRET_MISSING_ERROR,
  KEYCHAIN_SUPPORT_MISSING_ERROR,
  POT_PASSPHRASE_MISSING_ERROR,
} from './env.js'
import {
  KEYCHAIN_OPERATION_FAILED_ERROR as KEYCHAIN_OPERATION_FAILED_FROM_MODULE,
  KEYCHAIN_SUPPORT_MISSING_ERROR as KEYCHAIN_SUPPORT_MISSING_FROM_MODULE,
} from './pot-keychain.js'
import { redactSecrets } from './paywall-http.js'

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

  it('defaults spark network to MAINNET and rejects anything else', () => {
    assert.equal(resolveSparkNetwork({}), 'MAINNET')
    assert.equal(resolveSparkNetwork({ SPARK_NETWORK: 'mainnet' }), 'MAINNET')
    assert.equal(resolveSparkNetwork({ SPARK_NETWORK: '  ' }), 'MAINNET')
    assert.throws(
      () => resolveSparkNetwork({ SPARK_NETWORK: 'regtest' }),
      /MAINNET/,
    )
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

describe('resolvePotPassphrase keychain order', () => {
  const secret = 'dummy-keychain-passphrase-01'
  const envSecret = 'env-passphrase-value-0001'

  function memory(value: string | null, calls: { gets: number }) {
    return {
      getUnlockSecret() {
        calls.gets += 1
        return value
      },
      setUnlockSecret() {
        throw new Error('set must not run during resolve')
      },
      deleteUnlockSecret() {
        throw new Error('delete must not run during resolve')
      },
    }
  }

  it('keeps unset spend mode as free for the auth-required request path', () => {
    assert.equal(resolvePotSpendMode({}), 'free')
    assert.equal(resolvePotSpendMode({ ZAPPI_POT_USE_KEYCHAIN: '1' }), 'free')
    assert.equal(resolvePotSpendMode({ ZAPPI_POT_SPEND_MODE: 'auth_required' }), 'auth_required')
  })

  it('uses ZAPPI_POT_PASSPHRASE and does not read the keychain', () => {
    const calls = { gets: 0 }
    const value = resolvePotPassphrase(
      { ZAPPI_POT_PASSPHRASE: envSecret, ZAPPI_POT_USE_KEYCHAIN: '1' },
      { keychain: true, unlockKeychain: memory('other-passphrase-value-9999', calls) },
    )
    assert.equal(value, envSecret)
    assert.equal(calls.gets, 0)
  })

  it('reads an injected keychain into a local variable and does not write process.env', () => {
    const marker = 'ZAPPI_POT_PASSPHRASE'
    const previous = process.env[marker]
    delete process.env[marker]
    const calls = { gets: 0 }
    const env: { ZAPPI_POT_USE_KEYCHAIN: string; ZAPPI_POT_PASSPHRASE?: string } = {
      ZAPPI_POT_USE_KEYCHAIN: '1',
    }
    try {
      const value = resolvePotPassphrase(env, { unlockKeychain: memory(secret, calls) })
      assert.equal(value, secret)
      assert.equal(calls.gets, 1)
      assert.equal(process.env[marker], undefined)
      assert.equal(Object.prototype.hasOwnProperty.call(env, marker), false)
      assert.equal(wantsPotKeychain({ ZAPPI_POT_USE_KEYCHAIN: 'true' }), false)
      assert.equal(wantsPotKeychain({}, { keychain: true }), true)
    } finally {
      if (previous === undefined) delete process.env[marker]
      else process.env[marker] = previous
    }
  })

  it('opts in from opts.keychain when the env passphrase is unset', () => {
    const calls = { gets: 0 }
    assert.equal(
      resolvePotPassphrase({}, { keychain: true, unlockKeychain: memory(`${secret}\n`, calls) }),
      secret,
    )
    assert.equal(calls.gets, 1)
  })

  it('fails closed when the keychain is empty or unavailable, without echoing the secret', () => {
    const calls = { gets: 0 }
    assert.throws(
      () => resolvePotPassphrase({}, { keychain: true, unlockKeychain: memory(null, calls) }),
      (error: Error) => {
        assert.equal(error.message, KEYCHAIN_SECRET_MISSING_ERROR)
        assert.equal(error.message.includes(secret), false)
        return true
      },
    )
    assert.throws(
      () =>
        resolvePotPassphrase(
          { ZAPPI_POT_USE_KEYCHAIN: '1' },
          {
            loadUnlockKeychain() {
              throw new Error(`${secret} leaked`)
            },
          },
        ),
      (error: Error) => {
        assert.equal(error.message, KEYCHAIN_SUPPORT_MISSING_ERROR)
        assert.equal(error.message.includes(secret), false)
        assert.equal(error.message.includes('leaked'), false)
        return true
      },
    )
    assert.throws(
      () =>
        resolvePotPassphrase(
          {},
          {
            keychain: true,
            unlockKeychain: {
              getUnlockSecret() {
                throw new Error(KEYCHAIN_SUPPORT_MISSING_FROM_MODULE)
              },
              setUnlockSecret() {},
              deleteUnlockSecret() {
                return false
              },
            },
          },
        ),
      (error: Error) => {
        assert.equal(error.message, KEYCHAIN_SUPPORT_MISSING_ERROR)
        assert.equal(error.message, KEYCHAIN_SUPPORT_MISSING_FROM_MODULE)
        return true
      },
    )
    assert.equal(KEYCHAIN_OPERATION_FAILED_ERROR, KEYCHAIN_OPERATION_FAILED_FROM_MODULE)
    assert.throws(() => resolvePotPassphrase({}), (error: Error) => {
      assert.equal(error.message, POT_PASSPHRASE_MISSING_ERROR)
      return true
    })
  })

  it('rejects a short or placeholder keychain secret without echoing it', () => {
    const short = 'short-secret'
    assert.throws(
      () =>
        resolvePotPassphrase(
          {},
          {
            keychain: true,
            unlockKeychain: memory(short, { gets: 0 }),
          },
        ),
      (error: Error) => {
        assert.match(error.message, /at least 16/)
        assert.equal(error.message.includes(short), false)
        return true
      },
    )
    assert.throws(
      () =>
        resolvePotPassphrase(
          { ZAPPI_POT_PASSPHRASE: '<not-a-real-secret>' },
          {
            keychain: true,
            unlockKeychain: memory(secret, { gets: 0 }),
          },
        ),
      (error: Error) => {
        assert.match(error.message, /placeholder/)
        assert.equal(error.message.includes('not-a-real-secret'), false)
        return true
      },
    )
  })

  it('redacts a passphrase assignment so the value cannot reach stdout', () => {
    const redacted = redactSecrets(`unlock ZAPPI_POT_PASSPHRASE=${secret} end`)
    assert.equal(redacted.includes(secret), false)
    assert.match(redacted, /ZAPPI_POT_PASSPHRASE=\[redacted\]/)
  })
})
