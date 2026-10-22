import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { writeCliCredentials } from './credentials.js'
import { runDoorPotCreate, runDoorPotSend, runGuestCommand } from './cli-door-commands.js'
import type { PotEnv } from './env.js'
import { redactSecrets } from './paywall-http.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('cli door commands', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  function env(): PotEnv {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-door-'))
    dirs.push(dir)
    return {
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_CREDENTIALS_FILE: join(dir, 'credentials.json'),
      ZAPPI_CLI_GUEST_FILE: join(dir, 'agent.json'),
    }
  }

  function signIn(target: PotEnv): void {
    writeCliCredentials(
      {
        version: 1,
        apiUrl: 'https://api.test',
        accessToken: 'access-should-not-print',
        refreshToken: 'refresh-should-not-print',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        email: 'ada@example.com',
      },
      target,
    )
  }

  it('returns need_choice without failing the command', async () => {
    const target = env()
    signIn(target)
    const output = await runDoorPotCreate([], 'json', target, {
      fetchImpl: async () =>
        jsonResponse({
          status: 'need_choice',
          field: 'spendMode',
          message: 'Which spend mode should this pot use?',
          choices: [{ value: 'free', label: 'Free' }],
        }),
    })
    const parsed = JSON.parse(output) as { ok: boolean; status: string; command: string }
    assert.equal(parsed.ok, true)
    assert.equal(parsed.status, 'need_choice')
    assert.equal(parsed.command, 'pots create')
  })

  it('sends custom limits on create', async () => {
    const target = env()
    signIn(target)
    let sent: Record<string, unknown> = {}
    await runDoorPotCreate(
      [
        '--spend-mode',
        'free',
        '--skip-name',
        '--limits',
        'custom',
        '--per-payment',
        '10.5',
        '--per-day',
        '40',
      ],
      'json',
      target,
      {
        fetchImpl: async (_input, init) => {
          sent = JSON.parse(String(init?.body)) as Record<string, unknown>
          return jsonResponse({ status: 'active', potId: 'pot-1' })
        },
      },
    )
    assert.deepEqual(sent, {
      spendMode: 'free',
      skipName: true,
      limitsChoice: 'custom',
      perPaymentDollars: 10.5,
      perDayDollars: 40,
    })
  })

  it('stores the guest secret and does not print it', async () => {
    const target = env()
    const secret = `zcg_${'a'.repeat(32)}`
    const output = await runGuestCommand([], 'json', target, {
      fetchImpl: async () => jsonResponse({ secret }),
    })
    assert.equal(output.includes(secret), false)
    assert.equal(output.includes('zcg_'), false)
    const file = JSON.parse(readFileSync(target.ZAPPI_CLI_GUEST_FILE!, 'utf8')) as { secret: string }
    assert.equal(file.secret, secret)
    if (process.platform !== 'win32') {
      assert.equal(statSync(target.ZAPPI_CLI_GUEST_FILE!).mode & 0o077, 0)
    }
    assert.match(redactSecrets(`leak ${secret}`), /zcg_\[redacted\]/)
  })

  it('echoes the idempotency key it sent', async () => {
    const target = env()
    signIn(target)
    let sent = ''
    const output = await runDoorPotSend(
      ['--amount-cents', '100', '--to', 'spark1destination', '--idempotency-key', 'pay-once'],
      'json',
      target,
      {
        fetchImpl: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { idempotencyKey: string }
          sent = body.idempotencyKey
          return jsonResponse({ status: 'settled', txid: 'tx_1' })
        },
      },
    )
    const parsed = JSON.parse(output) as { idempotencyKey: string; txid: string; status: string }
    assert.equal(sent, 'pay-once')
    assert.equal(parsed.idempotencyKey, 'pay-once')
    assert.equal(parsed.txid, 'tx_1')
    assert.equal(parsed.status, 'settled')
  })
})
