import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { runCli } from './cli.js'

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

const ENV_VARS = [
  'ZAPPI_ACCESS_TOKEN',
  'ZAPPI_API_URL',
  'ZAPPI_PROJECT_API_KEY',
  'ZAPPI_POT_ID',
  'ZAPPI_POT_SEED',
]

describe('cli dispatcher: new wallet commands', () => {
  let originalFetch: typeof fetch | undefined
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    originalFetch = globalThis.fetch
    for (const key of ENV_VARS) savedEnv[key] = process.env[key]
    process.env.ZAPPI_ACCESS_TOKEN = 'jwt'
    process.env.ZAPPI_API_URL = 'https://api.test'
    delete process.env.ZAPPI_POT_ID
    delete process.env.ZAPPI_POT_SEED
  })

  afterEach(() => {
    globalThis.fetch = originalFetch!
    for (const key of ENV_VARS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it('routes `balance --json` to runBalance', async () => {
    const mocked = mockFetch(() =>
      jsonResponse({
        ok: true,
        walletAddress: 'spark1x',
        readonlyReady: true,
        tokenBalances: {},
        pendingTransfers: [],
        recentTransfers: [],
      }),
    )
    globalThis.fetch = mocked
    const out = await runCli(['balance', '--json'], 'json')
    const parsed = JSON.parse(out)
    assert.equal(parsed.command, 'balance')
    assert.equal(parsed.scope, 'wallet')
  })

  it('routes `transactions --json` to runTransactions', async () => {
    const mocked = mockFetch(() => jsonResponse({ ok: true, transactions: [] }))
    globalThis.fetch = mocked
    const out = await runCli(['transactions', '--json'], 'json')
    const parsed = JSON.parse(out)
    assert.equal(parsed.command, 'transactions')
    assert.equal(parsed.transactions.length, 0)
  })

  it('routes `pots --json` to runPotsList', async () => {
    const mocked = mockFetch(() => jsonResponse({ pots: [] }))
    globalThis.fetch = mocked
    const out = await runCli(['pots', '--json'], 'json')
    const parsed = JSON.parse(out)
    assert.equal(parsed.command, 'pots')
  })

  it('routes `withdraw-options --json`', async () => {
    const mocked = mockFetch(() => jsonResponse({ ok: true, options: [] }))
    globalThis.fetch = mocked
    const out = await runCli(['withdraw-options', '--json'], 'json')
    const parsed = JSON.parse(out)
    assert.equal(parsed.command, 'withdraw-options')
  })

  it('routes `withdraw status <id> --json`', async () => {
    const mocked = mockFetch(() =>
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
    globalThis.fetch = mocked
    const out = await runCli(['withdraw', 'status', 'w1', '--json'], 'json')
    const parsed = JSON.parse(out)
    assert.equal(parsed.command, 'withdraw status')
    assert.equal(parsed.status.status, 'completed')
  })

  it('rejects unknown withdraw subcommand', async () => {
    await assert.rejects(
      () => runCli(['withdraw', 'bogus'], 'json'),
      /Usage: zappi-cli withdraw/,
    )
  })

  it('rejects unknown send subcommand', async () => {
    await assert.rejects(
      () => runCli(['send', 'bogus'], 'json'),
      /Usage: zappi-cli send/,
    )
  })

  it('rejects unknown pots subcommand', async () => {
    await assert.rejects(
      () => runCli(['pots', 'bogus'], 'json'),
      /Usage: zappi-cli pots/,
    )
  })
})
