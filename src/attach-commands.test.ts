import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { botAttachApproveUrl, runPotAttach, runPotAttachStatus } from './attach-commands.js'
import { runCli } from './cli.js'
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

describe('botAttachApproveUrl', () => {
  it('names the pot and drops the user code', () => {
    const href = botAttachApproveUrl(
      'https://dev.zappi.money/?panel=pots&attach=req_1&code=PP3X-NB6Y',
      'f7b81134-3b01-49de-b114-ad433cb3bbac',
    )
    assert.equal(
      href,
      'https://dev.zappi.money/?panel=pots&attach=req_1&pot=f7b81134-3b01-49de-b114-ad433cb3bbac',
    )
    assert.equal(href.includes('PP3X-NB6Y'), false)
    assert.equal(href.includes('code='), false)
  })

  it('moves the link onto localhost when the app origin is local', () => {
    const href = botAttachApproveUrl(
      'https://zappi.money/?panel=pots&attach=req_1&code=PP3X-NB6Y',
      'f7b81134-3b01-49de-b114-ad433cb3bbac',
      'http://localhost:3000',
    )
    assert.equal(
      href,
      'http://localhost:3000/?panel=pots&attach=req_1&pot=f7b81134-3b01-49de-b114-ad433cb3bbac',
    )
  })
})

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

  it('runPotAttach does not create a link when this host is already attached', async () => {
    let calls = 0
    globalThis.fetch = mockFetch(() => {
      calls += 1
      return jsonResponse({ ok: false }, 500)
    })
    const out = await runPotAttach(['--no-poll'], 'json', {
      ...ENV,
      ZAPPI_POT_CLIENT_TOKEN: 'zpc_already_attached',
    })
    const parsed = JSON.parse(out)
    assert.equal(parsed.alreadyAttached, true)
    assert.equal(parsed.approveUrl, undefined)
    assert.equal(out.includes('zpc_already_attached'), false)
    assert.equal(out.includes('http'), false)
    assert.equal(calls, 0)
  })

  it('runPotAttach refuses an auth-required link that does not name a pot', async () => {
    let calls = 0
    globalThis.fetch = mockFetch(() => {
      calls += 1
      return jsonResponse({ ok: false }, 500)
    })
    await assert.rejects(
      () => runPotAttach(['--no-poll', '--spend-mode', 'auth_required'], 'plain', ENV),
      /ZAPPI_POT_ID/,
    )
    assert.equal(calls, 0)
  })

  it('runPotAttach --no-poll prints a pot link and withholds the user code', async () => {
    let posted: unknown
    globalThis.fetch = mockFetch((req) => {
      posted = req.body
      if (req.url.endsWith('/api/wallet/pots/attach') && req.method === 'POST') {
        return jsonResponse({
          requestId: 'r1',
          userCode: 'PP3X-NB6Y',
          deviceCode: 'device_secret_once',
          approveUrl:
            'https://dev.zappi.money/?panel=pots&attach=r1&code=PP3X-NB6Y&pot=f7b81134-3b01-49de-b114-ad433cb3bbac',
          expiresAt: '2099-01-01',
        })
      }
      return jsonResponse({ ok: false }, 404)
    })
    const out = await runPotAttach(['--no-poll', '--spend-mode', 'auth_required'], 'json', {
      ...ENV,
      ZAPPI_POT_ID: 'f7b81134-3b01-49de-b114-ad433cb3bbac',
    })
    assert.equal(out.includes('PP3X-NB6Y'), false)
    assert.equal(out.includes('code='), false)
    assert.equal(out.includes('localhost'), false)
    assert.match(out, /https:\/\/dev\.zappi\.money\/\?panel=pots&attach=r1&pot=/)
    assert.match(out, /pot=f7b81134-3b01-49de-b114-ad433cb3bbac/)
    assert.equal(
      (posted as { potId?: string }).potId,
      'f7b81134-3b01-49de-b114-ad433cb3bbac',
    )
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
    assert.equal('userCode' in parsed.pending, false)
    assert.equal(out.includes('ABCD'), false)
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

describe('pots attach names the pot (1-554)', () => {
  const POT = 'f7b81134-3b01-49de-b114-ad433cb3bbac'
  const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
  let originalFetch: typeof fetch | undefined
  let home: string
  let ENV: Record<string, string>

  /** Nest-shaped create: stores potId and echoes it on the approve link. */
  function nest(options: {
    echoPot?: string | null
    poll?: Record<string, unknown>
    credentials?: Record<string, unknown>
    calls?: Captured[]
  }) {
    return mockFetch((req) => {
      options.calls?.push(req)
      if (req.url.endsWith('/api/wallet/pots/attach') && req.method === 'POST') {
        const echo = options.echoPot === undefined ? (req.body as { potId?: string }).potId : options.echoPot
        return jsonResponse({
          requestId: 'r1',
          deviceCode: 'device_secret_once',
          approveUrl: `https://dev.zappi.money/?panel=pots&attach=r1${echo ? `&pot=${echo}` : ''}`,
          expiresAt: '2099-01-01',
          spendMode: 'auth_required',
        })
      }
      if (req.url.endsWith('/api/wallet/pots/attach/r1') && req.method === 'GET') {
        return jsonResponse({ requestId: 'r1', ...(options.poll ?? { status: 'pending', requestedPotId: POT }) })
      }
      if (req.url.endsWith('/api/wallet/pots/attach/r1/credentials')) {
        return jsonResponse({ requestId: 'r1', ...(options.credentials ?? {}) })
      }
      return jsonResponse({ ok: false }, 404)
    })
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch
    home = mkdtempSync(join(tmpdir(), 'zappi-attach-pot-'))
    ENV = { ZAPPI_ACCESS_TOKEN: 'jwt', ZAPPI_API_URL: 'https://api.test', ZAPPI_HOME: home }
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
    rmSync(home, { recursive: true, force: true })
  })

  it('--pot alone names the pot: sent to Nest and on the pairing link', async () => {
    const calls: Captured[] = []
    globalThis.fetch = nest({ calls })
    const out = await runPotAttach(['--pot', POT, '--spend-mode', 'auth_required', '--no-poll'], 'json', ENV)
    const create = calls.find((c) => c.method === 'POST')
    assert.deepEqual(create?.body, { spendMode: 'auth_required', potId: POT })
    assert.match(JSON.parse(out).pending.approveUrl, new RegExp(`pot=${POT}$`))
  })

  it('runs the web copy command through the dispatcher', async () => {
    const calls: Captured[] = []
    globalThis.fetch = nest({ calls })
    const saved = { ...process.env }
    Object.assign(process.env, ENV)
    delete process.env.ZAPPI_POT_ID
    try {
      const out = await runCli(['pots', 'attach', '--pot', POT, '--spend-mode', 'auth_required', '--no-poll'], 'json')
      assert.equal((calls[0].body as { potId?: string }).potId, POT)
      assert.match(out, new RegExp(`pot=${POT}`))
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
      Object.assign(process.env, saved)
    }
  })

  it('accepts --pot and ZAPPI_POT_ID when they name the same pot', async () => {
    globalThis.fetch = nest({})
    const out = await runPotAttach(['--pot', POT.toUpperCase(), '--spend-mode', 'auth_required', '--no-poll'], 'json', {
      ...ENV,
      ZAPPI_POT_ID: POT,
    })
    assert.equal(JSON.parse(out).ok, true)
  })

  it('fails closed when --pot and ZAPPI_POT_ID disagree, before calling Nest', async () => {
    const calls: Captured[] = []
    globalThis.fetch = nest({ calls })
    await assert.rejects(
      () => runPotAttach(['--pot', POT, '--spend-mode', 'auth_required', '--no-poll'], 'json', { ...ENV, ZAPPI_POT_ID: OTHER }),
      /Conflicting pot selectors: --pot f7b81134.* but ZAPPI_POT_ID=0a1b2c3d/,
    )
    assert.equal(calls.length, 0)
  })

  it('rejects --pot without a value and a malformed --pot without echoing it', async () => {
    const calls: Captured[] = []
    globalThis.fetch = nest({ calls })
    await assert.rejects(
      () => runPotAttach(['--spend-mode', 'auth_required', '--pot'], 'json', ENV),
      /--pot needs a pot id/,
    )
    await assert.rejects(
      () => runPotAttach(['--pot', 'zpc_oops_secret', '--spend-mode', 'auth_required'], 'json', ENV),
      (error: Error) => /--pot is not a pot id/.test(error.message) && !error.message.includes('zpc_oops_secret'),
    )
    assert.equal(calls.length, 0)
  })

  it('rejects an auth-required attach with no pot and tells the operator the --pot shape', async () => {
    const calls: Captured[] = []
    globalThis.fetch = nest({ calls })
    await assert.rejects(
      () => runPotAttach(['--spend-mode', 'auth_required'], 'json', ENV),
      /pots attach --pot <potId> --spend-mode auth_required/,
    )
    assert.equal(calls.length, 0)
  })

  it('prints no link and stores no device code when Nest does not echo the pot', async () => {
    globalThis.fetch = nest({ echoPot: null })
    await assert.rejects(
      () => runPotAttach(['--pot', POT, '--spend-mode', 'auth_required', '--no-poll'], 'json', ENV),
      /did not confirm pot f7b81134/,
    )
    assert.equal(existsSync(attachDeviceCodePath('r1', ENV)), false)
  })

  it('prints no link when Nest names a different pot', async () => {
    globalThis.fetch = nest({ echoPot: OTHER })
    await assert.rejects(
      () => runPotAttach(['--pot', POT, '--spend-mode', 'auth_required', '--no-poll'], 'json', ENV),
      /named a different pot/,
    )
    assert.equal(existsSync(attachDeviceCodePath('r1', ENV)), false)
  })

  it('does not store the client token when approval bound a different pot', async () => {
    const calls: Captured[] = []
    globalThis.fetch = nest({
      calls,
      poll: { status: 'approved', potId: OTHER },
      credentials: { status: 'approved', potId: OTHER, potClientToken: 'zpc_wrong_pot' },
    })
    await assert.rejects(
      () => runPotAttach(['--pot', POT, '--spend-mode', 'auth_required'], 'json', ENV),
      /approved for a different pot/,
    )
    assert.equal(calls.some((c) => c.url.endsWith('/credentials')), false)
    assert.equal(existsSync(potClientTokenPath('r1', ENV)), false)
  })

  it('does not store the client token when reclaim names a different pot', async () => {
    globalThis.fetch = nest({
      poll: { status: 'approved', potId: POT },
      credentials: { status: 'approved', potId: OTHER, potClientToken: 'zpc_wrong_pot' },
    })
    await assert.rejects(
      () => runPotAttach(['--pot', POT, '--spend-mode', 'auth_required'], 'json', ENV),
      /credentials are for a different pot/,
    )
    assert.equal(existsSync(potClientTokenPath('r1', ENV)), false)
  })

  it('stores the client token when the named prefix pot is approved', async () => {
    globalThis.fetch = nest({
      poll: { status: 'approved', potId: POT },
      credentials: { status: 'approved', potId: POT, grantId: 'g1', potClientToken: 'zpc_right_pot' },
    })
    const out = await runPotAttach(['--pot', POT.slice(0, 8), '--spend-mode', 'auth_required'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.status, 'approved')
    assert.equal(parsed.potId, POT)
    assert.equal(parsed.potClientTokenReceived, true)
    assert.equal(out.includes('zpc_right_pot'), false)
  })
})
