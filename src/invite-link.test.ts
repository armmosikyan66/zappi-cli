import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fetchPotInviteLink,
  INVITE_DISABLED,
  INVITE_LINK_MISSING,
  InviteLinkError,
  qualifyInviteUrl,
  runInviteLink,
} from './invite-link.js'
import { formatInvitePlain, formatInvitePretty, toJson } from './results.js'

const potId = '11111111-1111-4111-8111-111111111111'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('qualifyInviteUrl', () => {
  it('moves an absolute Nest URL onto the app origin and qualifies a path', () => {
    assert.equal(
      qualifyInviteUrl(
        'https://zappi.money/invite/ABCD2345',
        '/invite/ABCD2345',
        'https://zappi.money',
      ),
      'https://zappi.money/invite/ABCD2345',
    )
    assert.equal(
      qualifyInviteUrl(
        'https://zappi.money/invite/ABCD2345',
        '/invite/ABCD2345',
        'http://localhost:3000',
      ),
      'http://localhost:3000/invite/ABCD2345',
    )
    assert.equal(
      qualifyInviteUrl('/invite/ABCD2345', '/invite/ABCD2345', 'https://zappi.money'),
      'https://zappi.money/invite/ABCD2345',
    )
  })

  it('refuses to invent a URL when Nest omits the path', () => {
    assert.throws(
      () => qualifyInviteUrl('', undefined, 'https://zappi.money'),
      (error: unknown) =>
        error instanceof InviteLinkError && error.code === INVITE_LINK_MISSING,
    )
  })

  it('drops code=, deviceCode, zpc_, userinfo, and fragments from each URL shape', () => {
    const token = 'zpc_secret_token'
    const deviceCode = 'device_secret_once'
    const userCode = 'PP3X-NB6Y'
    const absolute = qualifyInviteUrl(
      `https://user:${token}@evil.example/invite/ABCD2345?code=${userCode}&deviceCode=${deviceCode}&token=${token}#code=${userCode}`,
      `/invite/ABCD2345?code=${userCode}&deviceCode=${deviceCode}`,
      'https://zappi.money',
      [deviceCode, token, userCode],
    )
    const relative = qualifyInviteUrl(
      `/invite/ABCD2345?code=${userCode}&deviceCode=${deviceCode}&token=${token}#deviceCode=${deviceCode}`,
      undefined,
      'http://localhost:3000',
      [deviceCode, token],
    )
    for (const href of [absolute, relative]) {
      assert.doesNotMatch(href, /deviceCode/i)
      assert.doesNotMatch(href, /zpc_/i)
      assert.doesNotMatch(href, /code=/i)
      assert.equal(href.includes(token), false)
      assert.equal(href.includes(deviceCode), false)
      assert.equal(href.includes(userCode), false)
      assert.equal(href.includes('evil.example'), false)
    }
    assert.equal(absolute, 'https://zappi.money/invite/ABCD2345')
    assert.equal(relative, 'http://localhost:3000/invite/ABCD2345')
  })

  it('refuses a path that still contains zpc_ and does not echo it', () => {
    const token = 'zpc_secret_token_value'
    assert.throws(
      () =>
        qualifyInviteUrl(
          `https://zappi.money/invite/${token}`,
          `/invite/${token}`,
          'https://zappi.money',
        ),
      (error: unknown) => {
        assert.ok(error instanceof InviteLinkError)
        assert.equal(error.code, INVITE_LINK_MISSING)
        assert.match(error.message, /pot client token/)
        assert.equal(error.message.includes(token), false)
        return true
      },
    )
  })
})

describe('fetchPotInviteLink', () => {
  const base = {
    potId,
    baseUrl: 'https://api.zappi.money',
    appOrigin: 'https://zappi.money',
  }

  it('returns the Nest URL and sends no authorization header', async () => {
    let headers: RequestInit['headers']
    const link = await fetchPotInviteLink({
      ...base,
      fetch: async (_url, init) => {
        headers = init?.headers
        return jsonResponse(200, {
          enabled: true,
          inviteUrl: 'https://zappi.money/invite/ABCD2345',
          sharePath: '/invite/ABCD2345',
        })
      },
    })
    assert.equal(link.inviteUrl, 'https://zappi.money/invite/ABCD2345')
    assert.equal(link.sharePath, '/invite/ABCD2345')
    const headerMap = new Headers(headers)
    assert.equal(headerMap.get('authorization'), null)
    assert.equal(headerMap.get('x-zappi-access-token'), null)
  })

  it('pretty, plain, and json omit deviceCode, zpc_, and code= from invite URLs', async () => {
    const token = 'zpc_secret_token'
    const deviceCode = 'device_secret_once'
    const userCode = 'PP3X-NB6Y'
    const link = await fetchPotInviteLink({
      ...base,
      fetch: async () =>
        jsonResponse(200, {
          enabled: true,
          inviteUrl:
            `https://user:${token}@evil.example/invite/ABCD2345` +
            `?code=${userCode}&deviceCode=${deviceCode}&token=${token}#code=${userCode}`,
          sharePath:
            `/invite/ABCD2345?code=${userCode}&deviceCode=${deviceCode}&token=${token}`,
        }),
    })
    assert.equal(link.inviteUrl, 'https://zappi.money/invite/ABCD2345')
    assert.equal(link.sharePath, '/invite/ABCD2345')
    const result = {
      ok: true as const,
      command: 'invite' as const,
      inviteUrl: link.inviteUrl,
      sharePath: link.sharePath,
    }
    const printed = {
      pretty: formatInvitePretty(result, 'pretty'),
      plain: formatInvitePlain(result),
      json: toJson(result),
    }
    for (const text of Object.values(printed)) {
      const urls = text.match(/https?:\/\/[^\s"]+/g) ?? []
      assert.ok(urls.length > 0, text)
      for (const href of urls) {
        assert.equal(href, 'https://zappi.money/invite/ABCD2345')
        assert.doesNotMatch(href, /deviceCode|zpc_|code=/i)
      }
      assert.equal(text.includes(token), false)
      assert.equal(text.includes(deviceCode), false)
      assert.equal(text.includes(userCode), false)
      assert.equal(text.includes('code='), false)
    }
    const parsed = JSON.parse(printed.json)
    assert.equal('deviceCode' in parsed, false)
    assert.equal('potClientToken' in parsed, false)
    assert.equal(parsed.deviceCodeReceived, undefined)
    assert.equal(parsed.potClientTokenReceived, undefined)
    assert.equal(parsed.sharePath, '/invite/ABCD2345')
  })

  it('fails closed when the flag is off', async () => {
    await assert.rejects(
      () =>
        fetchPotInviteLink({
          ...base,
          fetch: async () => jsonResponse(200, { enabled: false }),
        }),
      (error: unknown) =>
        error instanceof InviteLinkError && error.code === INVITE_DISABLED,
    )
  })

  it('fails closed when the pot has no code', async () => {
    await assert.rejects(
      () =>
        fetchPotInviteLink({
          ...base,
          fetch: async () =>
            jsonResponse(404, { ok: false, error: 'INVITE_LINK_MISSING' }),
        }),
      (error: unknown) =>
        error instanceof InviteLinkError && error.code === INVITE_LINK_MISSING,
    )
  })
})

describe('runInviteLink attach gate', () => {
  it('refuses invite on an auth-required pot that is not attached', async () => {
    let fetched = false
    await assert.rejects(
      () =>
        runInviteLink(
          [],
          {
            ZAPPI_POT_ID: potId,
            ZAPPI_POT_SPEND_MODE: 'auth_required',
            ZAPPI_HOME: '/tmp/zappi-cli-no-attach-home',
          },
          async () => {
            fetched = true
            throw new Error('must not fetch')
          },
        ),
      /not attached/,
    )
    assert.equal(fetched, false)
  })
})
