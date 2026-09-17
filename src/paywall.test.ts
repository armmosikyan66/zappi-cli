import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  consumeResource,
  isMeteredPricing,
  parseResourceId,
  payResource,
} from './paywall.js'
import { parseConsumeCliArgs, parsePayCliArgs } from './cli.js'

const here = dirname(fileURLToPath(import.meta.url))

const SEED =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'

function jsonResponse(status: number, body: Record<string, unknown> | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('parseResourceId', () => {
  it('accepts bare id', () => {
    assert.equal(parseResourceId('abc-123'), 'abc-123')
  })

  it('extracts id from paywall URL', () => {
    assert.equal(
      parseResourceId(
        'https://api.zappi.money/api/paywall/resources/res_abc123?foo=1',
      ),
      'res_abc123',
    )
  })

  it('decodes a percent-encoded id', () => {
    assert.equal(
      parseResourceId(
        'https://api-dev.zappi.money/api/paywall/resources/res%2Fslash',
      ),
      'res/slash',
    )
  })

  it('rejects empty and non-id strings', () => {
    assert.throws(() => parseResourceId('  '), /PaidResource/)
    assert.throws(() => parseResourceId('not a id'), /parse resource id/)
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

describe('pay + consume request shaping (mock fetch, no Spark)', () => {
  const env = {
    ZAPPI_POT_ID: 'pot_1',
    ZAPPI_API_URL: 'https://api.example.test',
  }

  it('settles with potId then auto-consumes a metered grant without printing secrets', async () => {
    const calls: {
      url: string
      method: string
      body: Record<string, unknown> | null
      token: string | null
    }[] = []
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
        token: headers.get('X-Zappi-Unlock-Token'),
      })
      if (url.endsWith('/res_1') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse(402, {
          accepts: [
            {
              payTo: 'spark1payto',
              extra: {
                priceCents: 25,
                pricingMode: 'metered',
                unlockMode: 'metered_grant',
              },
            },
          ],
        })
      }
      if (url.endsWith('/settle')) {
        return jsonResponse(200, {
          firstUnlock: true,
          unlockToken: 'zpu_secret_token',
        })
      }
      if (url.endsWith('/consume')) {
        return jsonResponse(200, {
          consumed: 1,
          grant: { grantRemaining: 9 },
        })
      }
      throw new Error(`unexpected ${url}`)
    }

    const output = await payResource('res_1', {
      env,
      fetch: fetchMock,
      loadSeed: () => SEED,
      readTokenIdentifier: async () => 'btkn1example',
      sendUsdb: async (input) => {
        assert.equal(input.receiverSparkAddress, 'spark1payto')
        assert.equal(input.amountCents, 25)
        assert.equal(input.mnemonic, SEED)
        return { sparkTxHash: 'aa'.repeat(32) }
      },
    })

    assert.match(output, /Settled resource res_1/)
    assert.match(output, /Consumed 1 unit/)
    assert.match(output, /grantRemaining: 9/)
    assert.doesNotMatch(output, /zpu_secret_token/)
    assert.doesNotMatch(output, /alpha bravo charlie/)
    assert.equal(calls[1]?.body?.potId, 'pot_1')
    assert.equal(calls[1]?.body?.sparkTxHash, 'aa'.repeat(32))
    assert.equal(calls[2]?.token, 'zpu_secret_token')
    assert.equal(calls[2]?.body?.units, 1)
    assert.match(calls[2]?.url ?? '', /\/consume$/)
  })

  it('skips auto-consume when --no-consume is set', async () => {
    const urls: string[] = []
    const output = await payResource('res_1', {
      env,
      autoConsume: false,
      fetch: async (input, init) => {
        urls.push(String(input))
        if ((init?.method ?? 'GET') === 'GET') {
          return jsonResponse(402, {
            accepts: [
              {
                payTo: 'spark1payto',
                extra: { priceCents: 10, pricingMode: 'metered' },
              },
            ],
          })
        }
        return jsonResponse(200, {
          firstUnlock: true,
          unlockToken: 'zpu_secret_token',
        })
      },
      loadSeed: () => SEED,
      readTokenIdentifier: async () => 'btkn1example',
      sendUsdb: async () => ({ sparkTxHash: 'bb'.repeat(32) }),
    })
    assert.match(output, /auto-consume skipped/)
    assert.equal(
      urls.some((url) => url.endsWith('/consume')),
      false,
    )
    assert.doesNotMatch(output, /zpu_secret_token/)
  })

  it('consume posts units with the header token and never prints it', async () => {
    const output = await consumeResource('res_9', {
      env: {
        ZAPPI_API_URL: 'https://api.example.test',
        ZAPPI_UNLOCK_TOKEN: 'zpu_env_token',
      },
      unlockToken: 'zpu_flag_ignored',
      units: 2,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers)
        assert.equal(headers.get('X-Zappi-Unlock-Token'), 'zpu_env_token')
        assert.equal(JSON.parse(String(init?.body)).units, 2)
        assert.match(String(input), /\/res_9\/consume$/)
        assert.doesNotMatch(String(input), /zpu_/)
        return jsonResponse(200, { grant: { grantRemaining: 4 } })
      },
    })
    assert.match(output, /Consumed 2 units on resource res_9/)
    assert.match(output, /grantRemaining: 4/)
    assert.doesNotMatch(output, /zpu_env_token/)
    assert.doesNotMatch(output, /zpu_flag_ignored/)
  })
})

describe('cli flags', () => {
  it('parses pay --no-consume and --units', () => {
    const parsed = parsePayCliArgs(['res_1', '--no-consume', '--units', '4'])
    assert.equal(parsed.resourceArg, 'res_1')
    assert.equal(parsed.noConsume, true)
    assert.equal(parsed.units, 4)
  })

  it('parses consume --unlock-token and --units', () => {
    const parsed = parseConsumeCliArgs([
      '--units',
      '2',
      'res_1',
      '--unlock-token',
      'zpu_flag',
    ])
    assert.equal(parsed.resourceArg, 'res_1')
    assert.equal(parsed.units, 2)
    assert.equal(parsed.unlockTokenFlag, 'zpu_flag')
  })
})

describe('package isolation', () => {
  it('does not import examples/ from the CLI or paywall modules', () => {
    for (const file of ['cli.js', 'paywall.js', 'propose-register.js']) {
      const source = readFileSync(join(here, file), 'utf8')
      assert.doesNotMatch(source, /examples\//)
    }
  })
})
