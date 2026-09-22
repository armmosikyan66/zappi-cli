import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { runPotAttach, runPotAttachStatus } from './attach-commands.js'

interface Captured {
  method: string
  url: string
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(handler: (req: Captured) => Response): typeof fetch {
  return (async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    return handler({ method, url, body })
  }) as typeof fetch
}

const ENV = {
  ZAPPI_ACCESS_TOKEN: 'jwt',
  ZAPPI_API_URL: 'https://api.test',
}

describe('attach commands', () => {
  let originalFetch: typeof fetch | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
  })

  it('runPotAttach with --no-poll creates pending and does not poll', async () => {
    let calls = 0
    const mocked = mockFetch((req) => {
      calls += 1
      if (req.url.endsWith('/api/wallet/pots/attach')) {
        return jsonResponse({
          requestId: 'r1',
          userCode: 'ABCD',
          approveUrl: 'https://zappi.money/?attach=r1',
          expiresAt: '2099-01-01',
        })
      }
      return jsonResponse({ ok: false }, 404)
    })
    globalThis.fetch = mocked
    const out = await runPotAttach(['--no-poll', '--spend-mode', 'free'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.pending.requestId, 'r1')
    assert.equal(calls, 1) // no poll call
  })

  it('runPotAttachStatus polls a request', async () => {
    const mocked = mockFetch(() =>
      jsonResponse({ status: 'approved', requestId: 'r1', potId: 'p1', grantId: 'g1' }),
    )
    globalThis.fetch = mocked
    const out = await runPotAttachStatus(['r1'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.status, 'approved')
    assert.equal(parsed.potId, 'p1')
  })

  it('runPotAttachStatus throws without a requestId', async () => {
    await assert.rejects(() => runPotAttachStatus([], 'json', ENV), /Usage/)
  })
})
