import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { runBalance, runTransactions } from './wallet-commands.js'

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

function mockFetch(handler: (req: Captured) => Response): {
  fetch: typeof fetch
  calls: Captured[]
} {
  const calls: Captured[] = []
  const mocked: typeof fetch = (async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const req: Captured = { method, url, body }
    calls.push(req)
    return handler(req)
  }) as typeof fetch
  return { fetch: mocked, calls }
}

describe('runBalance', () => {
  let originalFetch: typeof fetch | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
  })

  it('GETs /wallet/pots/:id/balance with --pot', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ potId: 'p1', balanceUsdCents: 500, pendingUsdCents: 0 }),
    )
    globalThis.fetch = fetch
    const out = await runBalance(['--pot', 'p1'], 'json', {
      ZAPPI_ACCESS_TOKEN: 'jwt',
      ZAPPI_API_URL: 'https://api.test',
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
    })
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots/env-pot/balance')
  })
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
