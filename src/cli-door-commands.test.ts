import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { writeCliCredentials } from './credentials.js'
import {
  runDoorPotCreate,
  runDoorPotSend,
  runDoorPotSendStatus,
  runDoorPotSpender,
  runGuestCommand,
} from './cli-door-commands.js'
import { SpenderNotFoundError, SpenderPullUncertain } from './spender-commands.js'
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

  it('posts the name only and ignores spend mode and limits', async () => {
    const target = env()
    signIn(target)
    let sent: Record<string, unknown> = {}
    await runDoorPotCreate(
      [
        '--spend-mode',
        'free',
        '--label',
        'Research',
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
    assert.deepEqual(sent, { label: 'Research' })
    assert.equal('spendMode' in sent, false)
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

  it('prints need_choice in json and does not pick a rail', async () => {
    const target = env()
    signIn(target)
    let posts = 0
    const output = await runDoorPotSend(
      ['--amount-cents', '100', '--to', '0xabc'],
      'json',
      target,
      {
        fetchImpl: async () => {
          posts += 1
          return jsonResponse({
            status: 'need_choice',
            message: 'Choose the asset and network for this address.',
            choices: [{ asset: 'usdc', networkId: 'base', networkName: 'Base' }],
          })
        },
      },
    )
    const parsed = JSON.parse(output) as { status: string; choices: unknown[] }
    assert.equal(posts, 1)
    assert.equal(parsed.status, 'need_choice')
    assert.equal(parsed.choices.length, 1)
  })

  it('pulls an allowance and sends the transaction id back', async () => {
    const target = env()
    signIn(target)
    const posts: Record<string, unknown>[] = []
    let pullArgs: readonly string[] = []
    const output = await runDoorPotSend(
      ['--amount-cents', '100', '--to', 'spark1destination', '--idempotency-key', 'first'],
      'json',
      target,
      {
        fetchImpl: async (input, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          assert.match(String(input), /\/api\/cli\/send$/)
          posts.push(body)
          if (posts.length === 1) {
            return jsonResponse({
              status: 'allowance_pull',
              requestId: 'req-pull',
              allowanceId: 'ab'.repeat(16),
              ownerPublicKey: `02${'cd'.repeat(32)}`,
              tokenIdentifier: 'ef'.repeat(32),
              receiverPublicKey: `03${'11'.repeat(32)}`,
              tokenAmount: '1000000',
            })
          }
          return jsonResponse({ status: 'settled', txid: 'tx-pull', requestId: 'req-pull' })
        },
        spawnSpender: async (_command, args) => {
          pullArgs = args
          return { code: 0, stdout: 'tx-pull\n', stderr: '' }
        },
      },
    )
    assert.equal(pullArgs[0], 'pull')
    assert.equal(pullArgs[pullArgs.indexOf('--amount') + 1], '1000000')
    assert.equal(posts[1]?.idempotencyKey, 'req-pull')
    assert.equal(posts[1]?.sparkTxId, 'tx-pull')
    assert.equal(posts[1]?.destinationAddress, 'spark1destination')
    const parsed = JSON.parse(output) as { status: string; txid: string }
    assert.equal(parsed.status, 'settled')
    assert.equal(parsed.txid, 'tx-pull')
  })

  it('reports an uncertain pull once and does not send again', async () => {
    const target = env()
    signIn(target)
    let posts = 0
    await assert.rejects(
      () =>
        runDoorPotSend(['--amount-cents', '100', '--to', 'spark1destination'], 'json', target, {
          fetchImpl: async () => {
            posts += 1
            return jsonResponse({
              status: 'allowance_pull',
              requestId: 'req-pull',
              allowanceId: 'ab'.repeat(16),
              ownerPublicKey: `02${'cd'.repeat(32)}`,
              tokenIdentifier: 'ef'.repeat(32),
              receiverPublicKey: `03${'11'.repeat(32)}`,
              tokenAmount: '1000000',
            })
          },
          spawnSpender: async () => ({ code: 2, stdout: '', stderr: 'operator refused' }),
        }),
      (error: unknown) => {
        assert.ok(error instanceof SpenderPullUncertain)
        assert.match(error.message, /uncertain/)
        assert.match(error.message, /operator refused/)
        assert.match(error.message, /Do not send again/)
        assert.equal(error.exitCode, 2)
        return true
      },
    )
    assert.equal(posts, 1)
  })

  it('names the spender install when the binary is missing', async () => {
    const target = env()
    signIn(target)
    await assert.rejects(
      () =>
        runDoorPotSend(['--amount-cents', '100', '--to', 'spark1destination'], 'json', target, {
          fetchImpl: async () =>
            jsonResponse({
              status: 'allowance_pull',
              requestId: 'req-pull',
              allowanceId: 'ab'.repeat(16),
              ownerPublicKey: `02${'cd'.repeat(32)}`,
              tokenIdentifier: 'ef'.repeat(32),
              receiverPublicKey: `03${'11'.repeat(32)}`,
              tokenAmount: '1000000',
            }),
          spawnSpender: async () => {
            const error = new Error('spawn') as NodeJS.ErrnoException
            error.code = 'ENOENT'
            throw error
          },
        }),
      (error: unknown) => error instanceof SpenderNotFoundError && /\/spender\/install/.test(error.message),
    )
  })

  it('refuses a send that needs an allowance', async () => {
    const target = env()
    signIn(target)
    await assert.rejects(
      () =>
        runDoorPotSend(['--amount-cents', '100', '--to', 'spark1destination'], 'json', target, {
          fetchImpl: async () =>
            jsonResponse({
              status: 'allowance_required',
              message: 'Set an allowance on this pot, then send again.',
            }),
        }),
      /Set an allowance on this pot/,
    )
  })

  it('returns an approve URL without waiting when asked', async () => {
    const target = env()
    signIn(target)
    let posts = 0
    const output = await runDoorPotSend(
      ['--amount-cents', '100', '--to', 'spark1destination', '--no-wait'],
      'json',
      target,
      {
        fetchImpl: async () => {
          posts += 1
          return jsonResponse({
            approveUrl: 'https://dev.zappi.money/pair?spend=req-approve',
          })
        },
      },
    )
    assert.equal(posts, 1)
    const parsed = JSON.parse(output) as { approveUrl: string }
    assert.match(parsed.approveUrl, /req-approve/)
  })

  it('polls payment status until the approve URL settles', async () => {
    const target = env()
    signIn(target)
    const seen: string[] = []
    let polls = 0
    const output = await runDoorPotSend(
      ['--amount-cents', '100', '--to', 'spark1destination'],
      'json',
      target,
      {
        sleep: async () => {},
        maxStatusPolls: 3,
        fetchImpl: async (input) => {
          const url = String(input)
          seen.push(url)
          if (url.includes('/payment-status')) {
            polls += 1
            if (polls === 1) return jsonResponse({ requestId: 'req-approve', status: 'pending' })
            return jsonResponse({ requestId: 'req-approve', status: 'settled', txid: 'tx-approved' })
          }
          return jsonResponse({
            approveUrl: 'https://dev.zappi.money/pair?spend=req-approve',
            requestId: 'req-approve',
          })
        },
      },
    )
    assert.equal(polls, 2)
    assert.equal(JSON.parse(output).txid, 'tx-approved')
    assert.equal(seen.some((url) => url.includes('requestId=req-approve')), true)
  })

  it('prints a browser step without spawning the spender', async () => {
    const target = env()
    signIn(target)
    let spawned = false
    const output = await runDoorPotSend(
      ['--amount-cents', '100', '--to', 'lnbc1invoice'],
      'json',
      target,
      {
        fetchImpl: async () =>
          jsonResponse({
            status: 'need_browser',
            potId: 'pot-1',
            next: 'The pot page has to be open to pay this Lightning invoice.',
          }),
        spawnSpender: async () => {
          spawned = true
          return { code: 0, stdout: '', stderr: '' }
        },
      },
    )
    assert.equal(spawned, false)
    assert.match(JSON.parse(output).next, /pot page/)
  })

  it('asks again with the chosen rail', async () => {
    const target = env()
    signIn(target)
    const posts: Record<string, unknown>[] = []
    await runDoorPotSend(['--amount-cents', '100', '--to', '0xabc'], 'pretty', target, {
      chooseSendRail: async () => ({ asset: 'usdc', destinationChain: 'base' }),
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        posts.push(body)
        if (posts.length === 1) {
          return jsonResponse({
            status: 'need_choice',
            choices: [{ asset: 'usdc', networkId: 'base', networkName: 'Base' }],
          })
        }
        return jsonResponse({ status: 'settled', txid: 'tx-choice' })
      },
    })
    assert.equal(posts[1]?.asset, 'usdc')
    assert.equal(posts[1]?.destinationChain, 'base')
  })

  it('reads send status and registers a spender key', async () => {
    const target = env()
    signIn(target)
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.includes('/payment-status')) {
        return jsonResponse({ requestId: 'req-1', status: 'settled', txid: 'tx-1' })
      }
      const body = JSON.parse(String(init?.body)) as { spenderPublicKey: string }
      assert.equal(body.spenderPublicKey, `02${'ab'.repeat(32)}`)
      return jsonResponse({ status: 'registered', potId: 'pot-1', spenderPublicKey: body.spenderPublicKey })
    }
    const status = await runDoorPotSendStatus(['req-1'], 'json', target, { fetchImpl })
    assert.equal(JSON.parse(status).txid, 'tx-1')
    assert.match(calls[0] ?? '', /requestId=req-1/)
    const registered = await runDoorPotSpender([], 'json', target, {
      fetchImpl,
      spawnSpender: async (_command, args) => {
        assert.deepEqual(args, ['pubkey'])
        return { code: 0, stdout: `02${'ab'.repeat(32)}\n`, stderr: '' }
      },
    })
    assert.equal(JSON.parse(registered).status, 'registered')
  })
})
