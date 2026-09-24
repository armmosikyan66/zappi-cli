import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { runPotAttach, runPotAttachStatus } from './attach-commands.js'
import { attachDeviceCodePath, potClientTokenPath } from './attach-device-secret.js'

interface Captured {
  method: string
  url: string
  body: unknown
  headers: Headers
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
    const headers = new Headers(init?.headers)
    return handler({ method, url, body, headers })
  }) as typeof fetch
}

describe('attach commands', () => {
  let originalFetch: typeof fetch | undefined
  let home: string
  let ENV: Record<string, string>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    home = mkdtempSync(join(tmpdir(), 'zappi-attach-'))
    ENV = {
      ZAPPI_ACCESS_TOKEN: 'jwt',
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_HOME: home,
    }
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
    rmSync(home, { recursive: true, force: true })
  })

  it('runPotAttach with --no-poll stores deviceCode and withholds it from JSON', async () => {
    let calls = 0
    const mocked = mockFetch((req) => {
      calls += 1
      if (req.url.endsWith('/api/wallet/pots/attach') && req.method === 'POST') {
        return jsonResponse({
          requestId: 'r1',
          userCode: 'ABCD',
          deviceCode: 'device_secret_once',
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
    assert.equal(parsed.pending.deviceCodeReceived, true)
    assert.equal('deviceCode' in parsed.pending, false)
    assert.equal(out.includes('device_secret_once'), false)
    assert.equal(calls, 1)
    const stored = readFileSync(attachDeviceCodePath('r1', ENV), 'utf8').trim()
    assert.equal(stored, 'device_secret_once')
  })

  it('runPotAttach polls then reclaims with X-Zappi-Device-Code and withholds zpc_', async () => {
    const calls: Captured[] = []
    const mocked = mockFetch((req) => {
      calls.push(req)
      if (req.url.endsWith('/api/wallet/pots/attach') && req.method === 'POST') {
        return jsonResponse({
          requestId: 'r1',
          userCode: 'ABCD',
          deviceCode: 'device_secret_once',
          approveUrl: 'https://zappi.money/?attach=r1',
          expiresAt: '2099-01-01',
        })
      }
      if (req.url.endsWith('/api/wallet/pots/attach/r1') && req.method === 'GET') {
        return jsonResponse({
          status: 'approved',
          requestId: 'r1',
          potId: 'p1',
          grantId: 'g1',
        })
      }
      if (req.url.endsWith('/api/wallet/pots/attach/r1/credentials') && req.method === 'POST') {
        assert.equal(req.headers.get('X-Zappi-Device-Code'), 'device_secret_once')
        return jsonResponse({
          status: 'approved',
          requestId: 'r1',
          potId: 'p1',
          grantId: 'g1',
          potClientToken: 'zpc_secret_token',
        })
      }
      return jsonResponse({ ok: false }, 404)
    })
    globalThis.fetch = mocked
    const out = await runPotAttach(['--spend-mode', 'free'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.status, 'approved')
    assert.equal(parsed.potClientTokenReceived, true)
    assert.equal(parsed.deviceCodeReceived, true)
    assert.equal('potClientToken' in parsed, false)
    assert.equal(out.includes('zpc_secret_token'), false)
    assert.equal(out.includes('device_secret_once'), false)
    const reclaim = calls.find((c) => c.url.endsWith('/credentials'))
    assert.ok(reclaim)
    assert.equal(reclaim!.headers.get('X-Zappi-Device-Code'), 'device_secret_once')
    const tokenFile = readFileSync(potClientTokenPath('r1', ENV), 'utf8').trim()
    assert.equal(tokenFile, 'zpc_secret_token')
  })

  it('pretty attach withholds zpc_ and never prints deviceCode', async () => {
    globalThis.fetch = mockFetch((req) => {
      if (req.url.endsWith('/api/wallet/pots/attach') && req.method === 'POST') {
        return jsonResponse({
          requestId: 'r1',
          userCode: 'ABCD',
          deviceCode: 'device_secret_once',
          approveUrl: 'https://zappi.money/?attach=r1',
          expiresAt: '2099-01-01',
        })
      }
      if (req.url.endsWith('/api/wallet/pots/attach/r1')) {
        return jsonResponse({ status: 'approved', requestId: 'r1', potId: 'p1', grantId: 'g1' })
      }
      if (req.url.endsWith('/credentials')) {
        return jsonResponse({
          status: 'approved',
          requestId: 'r1',
          potId: 'p1',
          grantId: 'g1',
          potClientToken: 'zpc_secret_token',
        })
      }
      return jsonResponse({ ok: false }, 404)
    })
    const out = await runPotAttach(['--spend-mode', 'free'], 'pretty', ENV)
    assert.match(out, /zpc_… \(withheld\)/)
    assert.equal(out.includes('zpc_secret_token'), false)
    assert.equal(out.includes('device_secret_once'), false)
  })

  it('runPotAttachStatus reclaims via ZAPPI_ATTACH_DEVICE_CODE env', async () => {
    const calls: Captured[] = []
    globalThis.fetch = mockFetch((req) => {
      calls.push(req)
      if (req.url.endsWith('/api/wallet/pots/attach/r1') && req.method === 'GET') {
        return jsonResponse({ status: 'approved', requestId: 'r1', potId: 'p1' })
      }
      if (req.url.endsWith('/credentials')) {
        assert.equal(req.headers.get('X-Zappi-Device-Code'), 'from_env_device')
        return jsonResponse({
          status: 'approved',
          requestId: 'r1',
          potId: 'p1',
          grantId: 'g1',
          potClientToken: 'zpc_from_reclaim',
        })
      }
      return jsonResponse({ ok: false }, 404)
    })
    const out = await runPotAttachStatus(['r1'], 'json', {
      ...ENV,
      ZAPPI_ATTACH_DEVICE_CODE: 'from_env_device',
    })
    const parsed = JSON.parse(out)
    assert.equal(parsed.status, 'approved')
    assert.equal(parsed.potClientTokenReceived, true)
    assert.equal(out.includes('zpc_from_reclaim'), false)
    assert.equal(out.includes('from_env_device'), false)
    assert.ok(calls.some((c) => c.url.endsWith('/credentials')))
  })

  it('runPotAttachStatus polls a request without reclaim when no device code', async () => {
    const mocked = mockFetch(() =>
      jsonResponse({ status: 'approved', requestId: 'r1', potId: 'p1', grantId: 'g1' }),
    )
    globalThis.fetch = mocked
    const out = await runPotAttachStatus(['r1'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.status, 'approved')
    assert.equal(parsed.potId, 'p1')
    assert.equal(parsed.potClientTokenReceived, false)
    assert.equal(parsed.deviceCodeAvailable, false)
  })

  it('runPotAttachStatus throws without a requestId', async () => {
    await assert.rejects(() => runPotAttachStatus([], 'json', ENV), /Usage/)
  })
})
