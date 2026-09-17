import {
  parsePositiveUnits,
  requirePotId,
  resolvePaywallBase,
  resolveSparkNetwork,
  resolveUnlockToken,
  type PotEnv,
} from './env.js'
import { loadPotSeed } from './load-pot-seed.js'
import {
  consumeGrant,
  getResource,
  redactSecrets,
  settleWithRetry,
  type PaywallClock,
  type PaywallHttpOptions,
} from './paywall-http.js'
import {
  readUsdbTokenIdentifier,
  sendUsdbFromPot,
  type SendUsdbFromPotInput,
  type SendUsdbFromPotResult,
} from './spark-send.js'

export interface PaywallAcceptExtra {
  priceCents?: number
  pricingMode?: string
  unlockMode?: string
  settlePath?: string
  consumePath?: string
  payToSparkAddress?: string
}

export interface PaywallAccept {
  payTo?: string
  maxAmountRequired?: string
  extra?: PaywallAcceptExtra
}

export interface PaywallChallenge {
  x402Version?: number
  accepts?: PaywallAccept[]
}

const DEFAULT_ACCOUNT_NUMBER = 0

export function parseResourceId(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Pass a PaidResource id or paywall URL.')
  }

  try {
    const url = new URL(trimmed)
    const match = url.pathname.match(/\/api\/paywall\/resources\/([^/?#]+)/i)
    if (match?.[1]) return decodeURIComponent(match[1])
  } catch {
    // not a URL
  }

  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed
  throw new Error(
    'Could not parse resource id. Use a UUID/slug or a full …/api/paywall/resources/:id URL.',
  )
}

export function isMeteredPricing(accept: PaywallAccept): boolean {
  const pricingMode = accept.extra?.pricingMode?.trim().toLowerCase()
  const unlockMode = accept.extra?.unlockMode?.trim().toLowerCase()
  return pricingMode === 'metered' || unlockMode === 'metered_grant'
}

function pickAccept(challenge: PaywallChallenge): PaywallAccept {
  const accept = challenge.accepts?.[0]
  if (!accept?.payTo) {
    throw new Error('402 response missing accepts[0].payTo')
  }
  const priceCents = accept.extra?.priceCents
  if (typeof priceCents !== 'number' || priceCents <= 0) {
    throw new Error('402 response missing extra.priceCents')
  }
  return accept
}

function httpOptions(
  env: PotEnv,
  extras: Pick<
    PaywallHttpOptions,
    'fetch' | 'clock' | 'log' | 'deadlineMs'
  > = {},
): PaywallHttpOptions {
  return {
    baseUrl: resolvePaywallBase(env),
    fetch: extras.fetch,
    clock: extras.clock,
    deadlineMs: extras.deadlineMs,
    log: extras.log
      ? (message) => extras.log?.(redactSecrets(message))
      : undefined,
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    return redactSecrets(String((body as { message: unknown }).message))
  }
  if (body && typeof body === 'object' && 'error' in body) {
    return redactSecrets(String((body as { error: unknown }).error))
  }
  return fallback
}

export interface PayResourceOptions {
  env?: PotEnv
  fetch?: typeof fetch
  clock?: PaywallClock
  deadlineMs?: number
  log?: (message: string) => void
  loadSeed?: (env: PotEnv) => string
  sendUsdb?: (input: SendUsdbFromPotInput) => Promise<SendUsdbFromPotResult>
  readTokenIdentifier?: (
    mnemonic: string,
    accountNumber: number,
    network: 'MAINNET' | 'REGTEST',
  ) => Promise<string>
  /** Default true: after settle, consume one grant unit when pricingMode is metered. */
  autoConsume?: boolean
  consumeUnits?: number
}

export async function payResource(
  resourceId: string,
  options: PayResourceOptions = {},
): Promise<string> {
  const env = options.env ?? process.env
  const potId = requirePotId(env)
  const loadSeed = options.loadSeed ?? loadPotSeed
  const mnemonic = loadSeed(env)
  const network = resolveSparkNetwork(env)
  const autoConsume = options.autoConsume ?? true
  const consumeUnits = options.consumeUnits ?? 1
  const http = httpOptions(env, options)

  const first = await getResource(resourceId, http)
  if (first.status === 200) {
    return 'Resource already unlocked (HTTP 200). Nothing to pay.'
  }
  if (first.status !== 402) {
    throw new Error(
      redactSecrets(`Expected HTTP 402 Payment Required, got ${first.status}.`),
    )
  }

  const challenge = first.body as PaywallChallenge
  const accept = pickAccept(challenge)
  const priceCents = accept.extra!.priceCents!
  const payTo = accept.payTo!
  const metered = isMeteredPricing(accept)

  const readToken = options.readTokenIdentifier ?? readUsdbTokenIdentifier
  const sendUsdb = options.sendUsdb ?? sendUsdbFromPot
  const tokenIdentifier = await readToken(
    mnemonic,
    DEFAULT_ACCOUNT_NUMBER,
    network,
  )

  const { sparkTxHash } = await sendUsdb({
    mnemonic,
    accountNumber: DEFAULT_ACCOUNT_NUMBER,
    network,
    tokenIdentifier,
    receiverSparkAddress: payTo,
    amountCents: priceCents,
  })

  const settled = await settleWithRetry(
    { resourceId, potId, sparkTxHash },
    http,
  )

  if (settled.status !== 200) {
    throw new Error(
      redactSecrets(
        `Settle failed (${settled.status}): ${messageFromBody(settled.body, 'unknown error')}`,
      ),
    )
  }

  const lines = [
    `Settled resource ${resourceId} (${priceCents} cents USDB).`,
    `sparkTxHash: ${sparkTxHash}`,
  ]
  if (settled.firstUnlock && settled.unlockToken) {
    lines.push(
      'Unlock token received (withheld from output). Store it as ZAPPI_UNLOCK_TOKEN — never echo it.',
    )
  }
  if (settled.unlockUrl) {
    lines.push(`unlockUrl: ${settled.unlockUrl}`)
  }

  const shouldConsume = autoConsume && metered && Boolean(settled.unlockToken)
  if (autoConsume && metered && !settled.unlockToken) {
    lines.push(
      'Metered resource: skip auto-consume (no first-unlock token). Set ZAPPI_UNLOCK_TOKEN and run zappi-pot consume.',
    )
  }
  if (shouldConsume && settled.unlockToken) {
    try {
      const consumed = await consumeGrant(
        resourceId,
        settled.unlockToken,
        consumeUnits,
        http,
      )
      lines.push(formatConsumeResult(resourceId, consumeUnits, consumed))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      lines.push(redactSecrets(`Auto-consume failed: ${message}`))
    }
  } else if (!autoConsume && metered) {
    lines.push(
      'Metered resource: auto-consume skipped (--no-consume). Run zappi-pot consume with ZAPPI_UNLOCK_TOKEN.',
    )
  }

  return lines.join('\n')
}

export interface ConsumeResourceOptions {
  env?: PotEnv
  fetch?: typeof fetch
  log?: (message: string) => void
  /** CLI `--unlock-token`. Env `ZAPPI_UNLOCK_TOKEN` wins when both are set. */
  unlockToken?: string
  units?: number
}

export async function consumeResource(
  resourceId: string,
  options: ConsumeResourceOptions = {},
): Promise<string> {
  const env = options.env ?? process.env
  const units = parsePositiveUnits(
    options.units == null ? undefined : String(options.units),
    1,
  )
  const unlockToken = resolveUnlockToken(env, options.unlockToken)
  const http = httpOptions(env, options)
  const consumed = await consumeGrant(resourceId, unlockToken, units, http)
  return formatConsumeResult(resourceId, units, consumed)
}

function formatConsumeResult(
  resourceId: string,
  units: number,
  consumed: { status: number; body: unknown },
): string {
  if (consumed.status === 200) {
    const remaining = grantRemainingFromBody(consumed.body)
    const lines = [
      `Consumed ${units} unit${units === 1 ? '' : 's'} on resource ${resourceId}.`,
    ]
    if (remaining != null) {
      lines.push(`grantRemaining: ${remaining}`)
    }
    return lines.join('\n')
  }

  const detail = messageFromBody(
    consumed.body,
    consumed.status === 402
      ? 'GRANT_EXHAUSTED or PAYMENT_REQUIRED'
      : 'consume failed',
  )
  throw new Error(
    redactSecrets(`Consume failed (${consumed.status}): ${detail}`),
  )
}

function grantRemainingFromBody(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  if (typeof record.grantRemaining === 'number') return record.grantRemaining
  const grant = record.grant
  if (grant && typeof grant === 'object') {
    const remaining = (grant as Record<string, unknown>).grantRemaining
    if (typeof remaining === 'number') return remaining
    const nested = (grant as Record<string, unknown>).remaining
    if (typeof nested === 'number') return nested
  }
  return undefined
}
