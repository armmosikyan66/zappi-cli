import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUTH_REQUIRED_PAY_ERROR } from './env.js'
import { redactSecrets } from './paywall-http.js'
import {
  buildSpendApproveUrl,
  createSpendRequestResult,
  formatSpendRequestOutput,
  parseRequestCliArgs,
} from './spend-request.js'
import { renderHelp } from './ui.js'

const TOKEN = 'zpc_liveSecretValue'
const ENV = {
  ZAPPI_POT_ID: 'pot_1',
  ZAPPI_POT_CLIENT_TOKEN: TOKEN,
  ZAPPI_API_URL: 'https://api.example.test',
  ZAPPI_APP_ORIGIN: 'https://zappi.money',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('parseRequestCliArgs', () => {
  it('reads amount, destination, chain, and memo', () => {
    const parsed = parseRequestCliArgs([
      '--amount-cents',
      '100',
      '--to',
      'spark1dest',
      '--chain',
      'spark',
      '--memo',
      'invoice 9',
    ])
    assert.deepEqual(parsed, {
      amountCents: 100,
      destinationAddress: 'spark1dest',
      destinationChain: 'spark',
      memo: 'invoice 9',
    })
  })

  it('refuses secret flags instead of prompting', () => {
    assert.throws(
      () => parseRequestCliArgs(['--amount-cents', '100', '--seed', 'phrase']),
      /Do not pass a session token/,
    )
    assert.throws(
      () =>
        parseRequestCliArgs([
          '--client-token',
          TOKEN,
          '--amount-cents',
          '100',
          '--to',
          'spark1dest',
        ]),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /ZAPPI_POT_CLIENT_TOKEN/)
        assert.doesNotMatch(error.message, new RegExp(TOKEN))
        return true
      },
    )
  })

  it('refuses a recovery phrase as the destination', () => {
    const phrase = Array.from({ length: 12 }, () => 'abandon').join(' ')
    assert.throws(
      () =>
        parseRequestCliArgs(['--amount-cents', '100', '--to', phrase]),
      /recovery phrase/,
    )
  })
})

describe('createSpendRequestResult', () => {
  it('posts the ticket with the pot client token and prints only the bare URL', async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined
    const result = await createSpendRequestResult({
      env: ENV,
      input: {
        amountCents: 100,
        destinationAddress: 'spark1dest',
      },
      fetch: async (input, init) => {
        seen = { url: String(input), init }
        return jsonResponse(201, {
          id: 'spr_1',
          potClientToken: TOKEN,
          approveUrl:
            'https://zappi.money/?panel=pots&spend=spr_1&code=AB3K-9Q2M',
        })
      },
    })

    assert.ok(seen)
    assert.match(
      seen.url,
      /\/api\/wallet\/self-custody\/pots\/pot_1\/spend-requests$/,
    )
    const headers = new Headers(seen.init?.headers)
    assert.equal(headers.get('x-zappi-pot-client'), TOKEN)
    assert.equal(seen.init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(seen.init?.body)), {
      amountCents: 100,
      destinationAddress: 'spark1dest',
    })
    assert.equal(
      result.approveUrl,
      'https://zappi.money/?panel=pots&spend=spr_1',
    )
    assert.doesNotMatch(result.approveUrl, /code=/)
    assert.equal(formatSpendRequestOutput(result, 'plain'), result.approveUrl)
    assert.equal(formatSpendRequestOutput(result, 'pretty'), result.approveUrl)
    const json = formatSpendRequestOutput(result, 'json')
    assert.equal(JSON.parse(json).command, 'request')
    assert.doesNotMatch(json, new RegExp(TOKEN))
    assert.doesNotMatch(json, /potClientToken/)
    assert.doesNotMatch(json, /code=/)
  })

  it('builds the spend URL when nest returns an id only', async () => {
    const result = await createSpendRequestResult({
      env: {
        ...ENV,
        ZAPPI_APP_ORIGIN: 'http://dev.zappi.money',
      },
      input: { amountCents: 100, destinationAddress: 'spark1dest' },
      fetch: async () =>
        jsonResponse(201, {
          id: 'spr_2',
          potClientToken: TOKEN,
        }),
    })
    assert.equal(
      result.approveUrl,
      buildSpendApproveUrl('spr_2', 'http://dev.zappi.money'),
    )
    assert.equal(
      result.approveUrl,
      'http://dev.zappi.money/?panel=pots&spend=spr_2',
    )
    assert.doesNotMatch(formatSpendRequestOutput(result, 'plain'), /zpc_/)
  })

  it('does not call nest without a pot client token', async () => {
    let fetched = false
    await assert.rejects(
      () =>
        createSpendRequestResult({
          env: { ZAPPI_POT_ID: 'pot_1' },
          input: { amountCents: 100, destinationAddress: 'spark1dest' },
          fetch: async () => {
            fetched = true
            throw new Error('must not fetch')
          },
        }),
      /ZAPPI_POT_CLIENT_TOKEN/,
    )
    assert.equal(fetched, false)
  })

  it('redacts a client token echoed in a nest error', async () => {
    await assert.rejects(
      () =>
        createSpendRequestResult({
          env: ENV,
          input: { amountCents: 100, destinationAddress: 'spark1dest' },
          fetch: async () =>
            jsonResponse(400, {
              message: `free pot refused ${TOKEN}`,
            }),
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /Spend request failed \(400\)/)
        assert.doesNotMatch(error.message, new RegExp(TOKEN))
        assert.match(error.message, /zpc_\[redacted\]/)
        return true
      },
    )
  })
})

describe('auth-required pay refusal', () => {
  it('points at request and does not ask for a session token', () => {
    assert.match(AUTH_REQUIRED_PAY_ERROR, /zappi-cli request/)
    assert.match(AUTH_REQUIRED_PAY_ERROR, /approve URL/)
    assert.doesNotMatch(AUTH_REQUIRED_PAY_ERROR, /ZAPPI_ACCESS_TOKEN|zappi_access/)
  })
})

describe('request help', () => {
  it('documents the no-code approve URL command', () => {
    const help = renderHelp('plain')
    assert.match(help, /request/)
    assert.match(help, /no user code/)
    assert.match(help, /ZAPPI_POT_CLIENT_TOKEN/)
    assert.doesNotMatch(help, /ZAPPI_ACCESS_TOKEN/)
  })
})

describe('pot client redaction', () => {
  it('strips the client token header and env assignment', () => {
    const redacted = redactSecrets(
      `x-zappi-pot-client: ${TOKEN} ZAPPI_POT_CLIENT_TOKEN=${TOKEN}`,
    )
    assert.doesNotMatch(redacted, new RegExp(TOKEN))
    assert.match(redacted, /x-zappi-pot-client: \[redacted\]/)
    assert.match(redacted, /ZAPPI_POT_CLIENT_TOKEN=\[redacted\]/)
  })
})
