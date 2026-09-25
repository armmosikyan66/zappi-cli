import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildZappiClient, hasZappiCredentials } from './client.js'

describe('buildZappiClient', () => {
  it('throws when no credentials are set', () => {
    assert.throws(
      () => buildZappiClient({}),
      /ZAPPI_PROJECT_API_KEY.*ZAPPI_ACCESS_TOKEN/,
    )
  })

  it('builds a projectKey client from ZAPPI_PROJECT_API_KEY', () => {
    const client = buildZappiClient({
      ZAPPI_PROJECT_API_KEY: 'pk_test',
      ZAPPI_API_URL: 'https://api.test',
    })
    assert.ok(client, 'client built')
  })

  it('builds a session client from ZAPPI_ACCESS_TOKEN', () => {
    const client = buildZappiClient({
      ZAPPI_ACCESS_TOKEN: 'jwt_test',
      ZAPPI_API_URL: 'https://api.test',
    })
    assert.ok(client, 'client built')
  })

  it('forwards cookie and user-agent for session auth', () => {
    // Construction does not throw; header forwarding is exercised in SDK tests.
    const client = buildZappiClient({
      ZAPPI_ACCESS_TOKEN: 'jwt_test',
      ZAPPI_COOKIE: 'zappi_access=abc',
      ZAPPI_USER_AGENT: 'zappi-cli/0.3',
      ZAPPI_API_URL: 'https://api.test',
    })
    assert.ok(client)
  })
})

describe('hasZappiCredentials', () => {
  it('returns false when empty', () => {
    assert.equal(hasZappiCredentials({}), false)
  })

  it('returns true for project key', () => {
    assert.equal(hasZappiCredentials({ ZAPPI_PROJECT_API_KEY: 'pk' }), true)
  })

  it('returns true for access token', () => {
    assert.equal(hasZappiCredentials({ ZAPPI_ACCESS_TOKEN: 'jwt' }), true)
  })
})

describe('resolveZappiClient apiUrl mismatch', () => {
  it('names the fix and forbids pot-client bypass', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { resolveZappiClient } = await import('./client.js')
    const dir = mkdtempSync(join(tmpdir(), 'zappi-cred-'))
    try {
      writeFileSync(
        join(dir, 'credentials.json'),
        JSON.stringify({
          version: 1,
          apiUrl: 'http://127.0.0.1:3011',
          accessToken: 'jwt',
          refreshToken: 'refresh',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          email: 'a@b.c',
        }),
        { mode: 0o600 },
      )
      await assert.rejects(
        () =>
          resolveZappiClient({
            ZAPPI_CREDENTIALS_FILE: join(dir, 'credentials.json'),
            ZAPPI_API_URL: 'https://api-dev.zappi.money',
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error)
          assert.match(err.message, /http:\/\/127\.0\.0\.1:3011/)
          assert.match(err.message, /api-dev\.zappi\.money/)
          assert.match(err.message, /zappi-cli login/)
          assert.match(err.message, /credentials\.json/)
          assert.match(err.message, /Do not bypass/)
          assert.match(err.message, /pot-client/)
          assert.match(err.message, /zpc_/)
          assert.doesNotMatch(err.message, /jwt/)
          return true
        },
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
