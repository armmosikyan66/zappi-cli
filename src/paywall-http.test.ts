import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  consumeGrant,
  getResource,
  nextBackoffMs,
  redactSecrets,
  settleWithRetry,
  shapeConsumeBody,
  shapeSettleBody,
  shouldRetrySettle,
} from './paywall-http.js'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('paywall retry policy', () => {
  it('retries 402 settle and 429/5xx, not 400', () => {
    assert.equal(shouldRetrySettle(402), true)
    assert.equal(shouldRetrySettle(429), true)
    assert.equal(shouldRetrySettle(503), true)
    assert.equal(shouldRetrySettle(400), false)
    assert.equal(shouldRetrySettle(200), false)
  })

  it('caps backoff at 8s', () => {
    assert.equal(nextBackoffMs(0), 1000)
    assert.equal(nextBackoffMs(3), 8000)
    assert.equal(nextBackoffMs(9), 8000)
  })

  it('redacts unlock tokens and seeds from logs', () => {
    const redacted = redactSecrets(
      'token zpu_abc123 and ZAPPI_POT_SEED=secret ZAPPI_UNLOCK_TOKEN=zpu_abc123 X-Zappi-Unlock-Token: zpu_abc123',
    )
    assert.doesNotMatch(redacted, /zpu_abc123/)
    assert.doesNotMatch(redacted, /ZAPPI_POT_SEED=secret/)
    assert.doesNotMatch(redacted, /ZAPPI_UNLOCK_TOKEN=zpu/)
    assert.match(redacted, /\[redacted\]/)
  })

  it('redacts pairing tokens and BIP-39-shaped word runs', () => {
    const mnemonic =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
    const redacted = redactSecrets(
      `pairing zpc_secretToken123 leaked ${mnemonic} into stderr`,
    )
    assert.doesNotMatch(redacted, /zpc_secretToken123/)
    assert.doesNotMatch(redacted, /alpha bravo charlie/)
    assert.match(redacted, /zpc_\[redacted\]/)
    assert.match(redacted, /\[redacted mnemonic\]/)
  })
})

describe('request shaping', () => {
  it('settle body requires potId and the same sparkTxHash', () => {
    assert.deepEqual(
      shapeSettleBody({
        sparkTxHash: 'aa'.repeat(32),
        potId: 'pot_1',
        idempotencyKey: 'idem_1',
      }),
      {
        sparkTxHash: 'aa'.repeat(32),
        potId: 'pot_1',
        idempotencyKey: 'idem_1',
      },
    )
  })

  it('consume body is units only', () => {
    assert.deepEqual(shapeConsumeBody(3), { units: 3 })
  })
})

describe('settleWithRetry', () => {
  it('replays the same hash after 402 then keeps the first unlock token', async () => {
    const calls: { url: string; body: unknown }[] = []
    const sleeps: number[] = []
    let now = 0
    const fetchMock: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      })
      const body = calls.at(-1)!.body as { potId: string; sparkTxHash: string }
      assert.equal(body.potId, 'pot_1')
      assert.equal(body.sparkTxHash, 'aa'.repeat(32))
      if (calls.length === 1) {
        return jsonResponse(402, { error: 'PAYMENT_REQUIRED' })
      }
      return jsonResponse(200, {
        firstUnlock: true,
        unlockToken: 'zpu_secret_token',
      })
    }

    const result = await settleWithRetry(
      {
        resourceId: 'res_1',
        potId: 'pot_1',
        sparkTxHash: 'aa'.repeat(32),
      },
      {
        fetch: fetchMock,
        clock: {
          now: () => now,
          sleep: async (ms) => {
            sleeps.push(ms)
            now += ms
          },
        },
        log: (message) => {
          assert.doesNotMatch(message, /zpu_secret/)
        },
      },
    )

    assert.equal(result.status, 200)
    assert.equal(result.firstUnlock, true)
    assert.equal(result.unlockToken, 'zpu_secret_token')
    assert.equal(calls.length, 2)
    assert.deepEqual(sleeps, [1000])
    assert.match(
      calls[0]?.url ?? '',
      /\/api\/paywall\/resources\/res_1\/settle$/,
    )
  })

  it('stops on 400 without signing a second body', async () => {
    let calls = 0
    const result = await settleWithRetry(
      {
        resourceId: 'res_1',
        potId: '',
        sparkTxHash: 'bb'.repeat(32),
      },
      {
        fetch: async () => {
          calls += 1
          return jsonResponse(400, { error: 'PAID_RESOURCE_POT_REQUIRED' })
        },
        clock: {
          now: () => 0,
          sleep: async () => {
            throw new Error('should not sleep after 400')
          },
        },
      },
    )
    assert.equal(result.status, 400)
    assert.equal(result.unlockToken, null)
    assert.equal(calls, 1)
  })

  it('expires instead of retrying forever', async () => {
    let now = 0
    const result = await settleWithRetry(
      {
        resourceId: 'res_1',
        potId: 'pot_1',
        sparkTxHash: 'cc'.repeat(32),
      },
      {
        deadlineMs: 1500,
        fetch: async () => jsonResponse(402, { error: 'PAYMENT_REQUIRED' }),
        clock: {
          now: () => now,
          sleep: async (ms) => {
            now += ms
          },
        },
      },
    )
    assert.equal(result.status, 402)
    assert.equal(result.unlockToken, null)
  })
})

describe('get and consume', () => {
  it('sends unlock tokens in headers without putting them in the URL', async () => {
    const urls: string[] = []
    await getResource(
      'res_1',
      {
        fetch: async (input) => {
          urls.push(String(input))
          return jsonResponse(200, { ok: true })
        },
      },
      'zpu_header_only',
    )
    assert.doesNotMatch(urls[0] ?? '', /zpu_header_only/)

    const consume = await consumeGrant('res_1', 'zpu_header_only', 2, {
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers)
        assert.equal(headers.get('X-Zappi-Unlock-Token'), 'zpu_header_only')
        assert.equal(JSON.parse(String(init?.body)).units, 2)
        assert.doesNotMatch(String(input), /zpu_header_only/)
        assert.match(
          String(input),
          /\/api\/paywall\/resources\/res_1\/consume$/,
        )
        return jsonResponse(402, { error: 'GRANT_EXHAUSTED' })
      },
    })
    assert.equal(consume.status, 402)
  })

  it('does not treat a public sparkTxHash as unlock proof on GET', async () => {
    const urls: string[] = []
    await getResource('res_1', {
      fetch: async (input) => {
        urls.push(String(input))
        return jsonResponse(402, { error: 'PAYMENT_REQUIRED' })
      },
    })
    assert.doesNotMatch(urls[0] ?? '', /sparkTxHash/)
    assert.doesNotMatch(urls[0] ?? '', /\?/)
  })
})
