import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { runBalance, runTransactions } from './wallet-commands.js'

interface Captured {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(handler: (req: Captured) => Response): {
  fetch: typeof fetch
  calls: Captured[]
} {
  const calls: Captured[] = []
  const mocked: typeof fetch = (async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const rawHeaders = init?.headers
    const headers: Record<string, string> = {}
    if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k.toLowerCase()] = String(v)
      }
    }
    const req: Captured = { method, url, body, headers }
    calls.push(req)
    return handler(req)
  }) as typeof fetch
  return { fetch: mocked, calls }
}

describe('runBalance', () => {
  let originalFetch: typeof fetch | undefined
  let emptyHome: string
  beforeEach(() => {
    originalFetch = globalThis.fetch
    emptyHome = mkdtempSync(join(tmpdir(), 'zappi-home-'))
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
    rmSync(emptyHome, { recursive: true, force: true })
  })

  it('GETs /wallet/pots/:id/balance with --pot', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ potId: 'p1', balanceUsdCents: 500, pendingUsdCents: 0 }),
    )
    globalThis.fetch = fetch
    const out = await runBalance(['--pot', 'p1'], 'json', {
      ZAPPI_ACCESS_TOKEN: 'jwt',
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_HOME: emptyHome,
    })
    const parsed = JSON.parse(out)
    assert.equal(parsed.scope, 'pot')
    assert.equal(parsed.balanceUsdCents, 500)
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots/p1/balance')
  })

  it('GETs /wallet/balance for the user wallet', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        ok: true,
        walletAddress: 'spark1x',
        readonlyReady: true,
        tokenBalances: { 'btkn_usdb': { ownedBalance: '5000000', availableToSendBalance: '5000000' } },
        pendingTransfers: [],
        recentTransfers: [],
      }),
    )
    globalThis.fetch = fetch
    const out = await runBalance([], 'json', {
      ZAPPI_ACCESS_TOKEN: 'jwt',
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_HOME: emptyHome,
    })
    const parsed = JSON.parse(out)
    assert.equal(parsed.scope, 'wallet')
    assert.equal(parsed.walletAddress, 'spark1x')
    assert.equal(parsed.usdbOwned, '5000000')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/balance')
  })

  it('uses ZAPPI_POT_ID when --pot is omitted', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ potId: 'env-pot', balanceUsdCents: 0, pendingUsdCents: 0 }),
    )
    globalThis.fetch = fetch
    await runBalance([], 'json', {
      ZAPPI_ACCESS_TOKEN: 'jwt',
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_POT_ID: 'env-pot',
      ZAPPI_HOME: emptyHome,
    })
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots/env-pot/balance')
  })
})


  it('GETs self-custody pot balance with pot-client token and no login', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        potId: 'p-agent',
        balanceUsdCents: 1250,
        pendingUsdCents: 25,
        availability: 'ready',
        stale: false,
      }),
    )
    globalThis.fetch = fetch
    const out = await runBalance(['--pot', 'p-agent'], 'json', {
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_POT_CLIENT_TOKEN: 'zpc_test_token_value',
      // deliberately no ZAPPI_ACCESS_TOKEN / credentials
    })
    assert.doesNotMatch(out, /zpc_/)
    const parsed = JSON.parse(out)
    assert.equal(parsed.scope, 'pot')
    assert.equal(parsed.auth, 'pot_client')
    assert.equal(parsed.potId, 'p-agent')
    assert.equal(parsed.balanceUsdCents, 1250)
    assert.equal(parsed.pendingUsdCents, 25)
    assert.equal(parsed.availability, 'ready')
    assert.equal(parsed.stale, false)
    assert.equal(
      calls[0].url,
      'https://api.test/api/wallet/self-custody/pots/p-agent/balance',
    )
    assert.equal(calls[0].method, 'GET')
    assert.equal(calls[0].headers['x-zappi-pot-client'], 'zpc_test_token_value')
    assert.equal(calls[0].headers['authorization'], undefined)
  })

  it('prefers pot-client balance when auth_required even if login env is set', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        potId: 'p2',
        balanceUsdCents: 1,
        pendingUsdCents: 0,
        availability: 'ready',
      }),
    )
    globalThis.fetch = fetch
    const out = await runBalance(['--pot', 'p2'], 'json', {
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_ACCESS_TOKEN: 'jwt-should-not-be-used',
      ZAPPI_POT_CLIENT_TOKEN: 'zpc_agent_only',
      ZAPPI_POT_SPEND_MODE: 'auth_required',
    })
    assert.doesNotMatch(out, /zpc_/)
    assert.doesNotMatch(out, /jwt-should-not-be-used/)
    const parsed = JSON.parse(out)
    assert.equal(parsed.auth, 'pot_client')
    assert.equal(
      calls[0].url,
      'https://api.test/api/wallet/self-custody/pots/p2/balance',
    )
    assert.equal(calls[0].headers['x-zappi-pot-client'], 'zpc_agent_only')
  })

  it('plain pot-client balance omits secrets', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        potId: 'p3',
        balanceUsdCents: 50,
        pendingUsdCents: 0,
        availability: 'ready',
      }),
    )
    globalThis.fetch = fetch
    const out = await runBalance(['--pot', 'p3'], 'plain', {
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_POT_CLIENT_TOKEN: 'zpc_plain_secret',
    })
    assert.doesNotMatch(out, /zpc_/)
    assert.match(out, /pot p3/)
    assert.match(out, /balance: 50 cents/)
  })

describe('runTransactions', () => {
  let originalFetch: typeof fetch | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
  })

  it('lists transactions', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        ok: true,
        transactions: [
          { id: 't1', type: 'deposit', status: 'completed', amountCents: 100, occurredAt: 't' },
        ],
      }),
    )
    globalThis.fetch = fetch
    const out = await runTransactions([], 'json', {
      ZAPPI_ACCESS_TOKEN: 'jwt',
      ZAPPI_API_URL: 'https://api.test',
    })
    const parsed = JSON.parse(out)
    assert.equal(parsed.transactions.length, 1)
    assert.equal(calls[0].url, 'https://api.test/api/wallet/transactions')
  })

  it('fetches a single transaction by id', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        ok: true,
        transaction: { id: 't1', type: 'deposit', status: 'completed', amountCents: 100 },
      }),
    )
    globalThis.fetch = fetch
    const out = await runTransactions(['t1'], 'json', {
      ZAPPI_ACCESS_TOKEN: 'jwt',
      ZAPPI_API_URL: 'https://api.test',
    })
    const parsed = JSON.parse(out)
    assert.equal(parsed.transaction.id, 't1')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/transactions/t1')
  })
})
