import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { runDepositOptions, runDepositAddress } from './deposit-commands.js'
import {
  runWithdrawOptions,
  runWithdrawEstimate,
  runWithdrawQuote,
  runWithdrawStatus,
} from './withdraw-commands.js'

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
    calls.push({ method, url, body })
    return handler({ method, url, body })
  }) as typeof fetch
  return { fetch: mocked, calls }
}

const ENV = {
  ZAPPI_ACCESS_TOKEN: 'jwt',
  ZAPPI_API_URL: 'https://api.test',
}

describe('deposit commands', () => {
  let originalFetch: typeof fetch | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
  })

  it('runDepositOptions lists the catalog', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        ok: true,
        options: [{ asset: 'btc', networks: [{ id: 'mainnet', estimatedArrivalCopy: 'instant' }] }],
      }),
    )
    globalThis.fetch = fetch
    const out = await runDepositOptions([], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.options.length, 1)
    assert.equal(calls[0].url, 'https://api.test/api/wallet/deposit-options')
  })

  it('runDepositAddress forwards asset/network', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ address: '0xabc', asset: 'usdc', network: 'solana' }),
    )
    globalThis.fetch = fetch
    await runDepositAddress(['--asset', 'usdc', '--network', 'solana'], 'json', ENV)
    assert.equal(
      calls[0].url,
      'https://api.test/api/wallet/deposit/destination?asset=usdc&network=solana',
    )
  })

  it('runDepositAddress throws without asset/network', async () => {
    await assert.rejects(() => runDepositAddress([], 'json', ENV), /Usage/)
  })
})

describe('withdraw commands (no signing)', () => {
  let originalFetch: typeof fetch | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
  })

  it('runWithdrawOptions lists the catalog', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        ok: true,
        options: [{ asset: 'btc', networks: [{ id: 'mainnet', estimatedArrivalCopy: 'instant' }] }],
      }),
    )
    globalThis.fetch = fetch
    const out = await runWithdrawOptions([], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.options.length, 1)
    assert.equal(calls[0].url, 'https://api.test/api/wallet/withdrawal-options')
  })

  it('runWithdrawEstimate POSTs the request', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        combo: { asset: 'usdc', network: 'solana' },
        netReceivedCents: 95,
        networkFeeCents: 5,
      }),
    )
    globalThis.fetch = fetch
    const out = await runWithdrawEstimate(
      ['--asset', 'usdc', '--network', 'solana', '--address', '0x', '--amount', '100'],
      'json',
      ENV,
    )
    const parsed = JSON.parse(out)
    assert.equal(parsed.estimate.netReceivedCents, 95)
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/withdraw/estimate')
  })

  it('runWithdrawQuote POSTs and returns quoteId', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        quoteId: 'q1',
        combo: { asset: 'usdc', network: 'solana' },
        estimatedArrivalCopy: 'soon',
        expiresAt: '2099-01-01',
      }),
    )
    globalThis.fetch = fetch
    const out = await runWithdrawQuote(
      ['--asset', 'usdc', '--network', 'solana', '--address', '0x', '--amount', '100'],
      'json',
      ENV,
    )
    const parsed = JSON.parse(out)
    assert.equal(parsed.quote.quoteId, 'q1')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/withdraw/quote')
  })

  it('runWithdrawStatus GETs status', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        ok: true,
        withdrawId: 'w1',
        status: 'completed',
        asset: 'USDC',
        networkId: 'solana',
        address: '0x',
        amountCents: 100,
      }),
    )
    globalThis.fetch = fetch
    const out = await runWithdrawStatus(['w1'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.status.status, 'completed')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/withdraw/status?id=w1')
  })

  it('runWithdrawStatus throws without id', async () => {
    await assert.rejects(() => runWithdrawStatus([], 'json', ENV), /Usage/)
  })
})
