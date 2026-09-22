import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import {
  runPotsList,
  runPotRegister,
  runPotDepositAddress,
  runPotGrants,
  runPotSpendGate,
  runPotSpendApprovals,
} from './pots-commands.js'

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

describe('pots commands', () => {
  let originalFetch: typeof fetch | undefined
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch!
  })

  it('runPotsList forwards filters', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ pots: [{ id: 'p1', sparkAddress: 'spark1x', grants: [] }] }),
    )
    globalThis.fetch = fetch
    const out = await runPotsList(['--spend-mode', 'free'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.pots.length, 1)
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots?spendMode=free')
  })

  it('runPotRegister POSTs the body', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ id: 'p1', sparkAddress: 'spark1x', grants: [] }),
    )
    globalThis.fetch = fetch
    await runPotRegister(['spark1x', '--label', 'Research', '--spend-mode', 'free'], 'json', ENV)
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots')
    assert.deepEqual(calls[0].body, { sparkAddress: 'spark1x', label: 'Research', spendMode: 'free' })
  })

  it('runPotRegister throws without an address', async () => {
    await assert.rejects(() => runPotRegister([], 'json', ENV), /Usage/)
  })

  it('runPotDepositAddress POSTs to deposit-address', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ potId: 'p1', depositAddress: '0xabc' }),
    )
    globalThis.fetch = fetch
    const out = await runPotDepositAddress(['p1', '--source-chain', 'base'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.depositAddress, '0xabc')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots/p1/deposit-address')
    assert.equal((calls[0].body as { sourceChain: string }).sourceChain, 'base')
  })

  it('runPotGrants creates a grant with --create', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ id: 'g1', potId: 'p1', scopes: ['read'] }),
    )
    globalThis.fetch = fetch
    const out = await runPotGrants(['p1', '--create', '--scopes', 'read,deposit'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.action, 'create')
    assert.deepEqual(calls[0].body, { scopes: ['read', 'deposit'] })
  })

  it('runPotGrants revokes with --revoke', async () => {
    const { fetch, calls } = mockFetch(() => new Response(null, { status: 204 }))
    globalThis.fetch = fetch
    const out = await runPotGrants(['p1', '--revoke', 'g1'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.action, 'revoke')
    assert.equal(calls[0].method, 'DELETE')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots/p1/grants/g1')
  })

  it('runPotGrants lists when no action flag', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ grants: [{ id: 'g1', potId: 'p1', scopes: ['read'] }] }),
    )
    globalThis.fetch = fetch
    const out = await runPotGrants(['p1'], 'json', ENV)
    const parsed = JSON.parse(out)
    assert.equal(parsed.action, 'list')
    assert.equal(parsed.grants.length, 1)
  })

  it('runPotSpendGate forwards action', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ potId: 'p1', spendMode: 'free', gated: false, leash: 'empty_balance' }),
    )
    globalThis.fetch = fetch
    await runPotSpendGate(['p1', '--action', 'withdraw'], 'json', ENV)
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots/p1/spend-gate?action=withdraw')
  })

  it('runPotSpendApprovals creates with --create', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ id: 'a1', potId: 'p1', action: 'withdraw', status: 'pending' }),
    )
    globalThis.fetch = fetch
    const out = await runPotSpendApprovals(
      ['p1', '--create', '--action', 'withdraw', '--amount', '100', '--destination', '0x'],
      'json',
      ENV,
    )
    const parsed = JSON.parse(out)
    assert.equal(parsed.action, 'create')
    assert.deepEqual(calls[0].body, { action: 'withdraw', amountCents: 100, destination: '0x' })
  })

  it('runPotSpendApprovals approves with --approve and forwards auth', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ id: 'a1', potId: 'p1', action: 'withdraw', status: 'approved' }),
    )
    globalThis.fetch = fetch
    await runPotSpendApprovals(['p1', '--approve', 'a1', '--auth', 'stepup'], 'json', ENV)
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, 'https://api.test/api/wallet/pots/p1/spend-approvals/a1/approve')
  })
})
