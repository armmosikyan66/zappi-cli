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
