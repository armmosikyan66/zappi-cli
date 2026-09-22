import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { resolveZappiClient } from './client.js'
import { runLogin, runLogout, runWhoami } from './login-commands.js'

const SECRET = 'access-token-should-not-print'
const REFRESH = 'refresh-token-should-not-print'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('zappi-cli login', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  function envFile() {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-login-'))
    dirs.push(dir)
    return {
      ZAPPI_API_URL: 'https://api.test',
      ZAPPI_CREDENTIALS_FILE: join(dir, 'credentials.json'),
    }
  }

  it('saves a session after approval and does not print the tokens', async () => {
    const env = envFile()
    const seen: string[] = []
    let polls = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      seen.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/api/auth/cli/device')) {
        return jsonResponse({
          deviceCode: 'device-secret',
          userCode: 'WDJB-MJHT',
          verificationUriComplete: 'https://zappi.money/cli?code=WDJB-MJHT',
          expiresIn: 900,
          interval: 1,
        })
      }
      polls += 1
      if (polls === 1) {
        return jsonResponse({ error: 'authorization_pending', interval: 1 }, 400)
      }
      return jsonResponse({
        accessToken: SECRET,
        refreshToken: REFRESH,
        expiresIn: 900,
        email: 'ada@example.com',
      })
    }

    const output = await runLogin([], 'json', env, {
      fetchImpl,
      openUrl: () => undefined,
      sleep: async () => undefined,
      writeErr: () => undefined,
    })

    assert.equal(output.includes(SECRET), false)
    assert.equal(output.includes(REFRESH), false)
    assert.equal(output.includes('device-secret'), false)
    const parsed = JSON.parse(output)
    assert.equal(parsed.command, 'login')
    assert.equal(parsed.email, 'ada@example.com')

    const file = JSON.parse(readFileSync(env.ZAPPI_CREDENTIALS_FILE, 'utf8'))
    assert.equal(file.accessToken, SECRET)
    if (process.platform !== 'win32') {
      assert.equal(statSync(env.ZAPPI_CREDENTIALS_FILE).mode & 0o077, 0)
    }

    const client = await resolveZappiClient(env)
    assert.ok(client)

    const who = await runWhoami([], 'json', env, {
      fetchImpl: async () =>
        jsonResponse({ user: { email: 'ada@example.com', username: 'ada' } }),
    })
    assert.match(who, /ada@example.com/)
    assert.equal(who.includes(SECRET), false)

    const loggedOut = await runLogout([], 'json', env, {
      fetchImpl: async () => jsonResponse({ ok: true }),
    })
    assert.match(loggedOut, /logout/)
    assert.throws(() => readFileSync(env.ZAPPI_CREDENTIALS_FILE, 'utf8'))
  })

  it('stops when the browser denies the code', async () => {
    const env = envFile()
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/api/auth/cli/device')) {
        return jsonResponse({
          deviceCode: 'device-secret',
          userCode: 'WDJB-MJHT',
          verificationUriComplete: 'https://zappi.money/cli?code=WDJB-MJHT',
          expiresIn: 900,
          interval: 1,
        })
      }
      return jsonResponse(
        { error: 'access_denied', message: 'You denied this login in Zappi.' },
        400,
      )
    }
    await assert.rejects(
      () =>
        runLogin(['--no-browser'], 'plain', env, {
          fetchImpl,
          sleep: async () => undefined,
          writeErr: () => undefined,
        }),
      /denied/i,
    )
    assert.throws(() => readFileSync(env.ZAPPI_CREDENTIALS_FILE, 'utf8'))
  })
})
