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

const potId = '11111111-1111-4111-8111-111111111111'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('qualifyInviteUrl', () => {
  it('keeps an absolute Nest URL and qualifies a path with the app origin', () => {
    assert.equal(
      qualifyInviteUrl(
        'https://zappi.money/invite/ABCD2345',
        '/invite/ABCD2345',
        'https://zappi.money',
      ),
      'https://zappi.money/invite/ABCD2345',
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
