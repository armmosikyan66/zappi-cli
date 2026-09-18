import {
  AUTH_REQUIRED_PAY_ERROR,
  parsePositiveUnits,
  requirePotId,
  resolvePaywallBase,
  resolvePotSpendMode,
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
import { isMeteredPricing, pickPaywallAccept, type PaywallChallenge } from './paywall-accept.js'
import {
  formatConsumePlain,
  formatPayPlain,
  type ConsumeResult,
  type PayResult,
} from './results.js'

export {
  PAYABLE_PAYWALL_ASSET,
  PAYABLE_PAYWALL_NETWORK,
  isMeteredPricing,
  pickPaywallAccept,
} from './paywall-accept.js'
export type {
  PaywallAccept,
  PaywallAcceptExtra,
  PaywallChallenge,
  SelectedPaywallAccept,
} from './paywall-accept.js'

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
  /** Optional progress labels (spinner-friendly). Never include secrets. */
  onStatus?: (label: string) => void
}

export async function payResourceResult(
  resourceId: string,
  options: PayResourceOptions = {},
): Promise<PayResult> {
  const env = options.env ?? process.env
  const potId = requirePotId(env)
  if (resolvePotSpendMode(env) === 'auth_required') {
    throw new Error(AUTH_REQUIRED_PAY_ERROR)
  }
  const loadSeed = options.loadSeed ?? loadPotSeed
  const mnemonic = loadSeed(env)
  const sparkNetwork = resolveSparkNetwork(env)
  const autoConsume = options.autoConsume ?? true
  const consumeUnits = options.consumeUnits ?? 1
  const http = httpOptions(env, options)
  const onStatus = options.onStatus

  onStatus?.('Checking resource…')
  const first = await getResource(resourceId, http)
  if (first.status === 200) {
    return {
      ok: true,
      command: 'pay',
      status: 'already_unlocked',
      resourceId,
      potId,
    }
  }
  if (first.status !== 402) {
    throw new Error(
      redactSecrets(`Expected HTTP 402 Payment Required, got ${first.status}.`),
    )
  }

  const challenge = first.body as PaywallChallenge
  const selected = pickPaywallAccept(challenge)
  const { payTo, priceCents, network, asset } = selected
  const metered = isMeteredPricing(selected.accept)

  const readToken = options.readTokenIdentifier ?? readUsdbTokenIdentifier
  const sendUsdb = options.sendUsdb ?? sendUsdbFromPot
  onStatus?.('Reading pot USDB token…')
  const tokenIdentifier = await readToken(
    mnemonic,
    DEFAULT_ACCOUNT_NUMBER,
    sparkNetwork,
  )

  onStatus?.(`Signing ${priceCents}¢ USDB…`)
  const { sparkTxHash } = await sendUsdb({
    mnemonic,
    accountNumber: DEFAULT_ACCOUNT_NUMBER,
    network: sparkNetwork,
    tokenIdentifier,
    receiverSparkAddress: payTo,
    amountCents: priceCents,
  })

  onStatus?.('Settling payment…')
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

  const notes: string[] = []
  const unlockTokenReceived = Boolean(settled.firstUnlock && settled.unlockToken)

  const shouldConsume = autoConsume && metered && Boolean(settled.unlockToken)
  if (autoConsume && metered && !settled.unlockToken) {
    notes.push(
      'Metered resource: skip auto-consume (no first-unlock token). Set ZAPPI_UNLOCK_TOKEN and run zappi-cli consume.',
    )
  } else if (!autoConsume && metered) {
    notes.push(
      'Metered resource: auto-consume skipped (--no-consume). Run zappi-cli consume with ZAPPI_UNLOCK_TOKEN.',
    )
  }

  let consume: ConsumeResult | undefined
  if (shouldConsume && settled.unlockToken) {
    try {
      onStatus?.(
        `Consuming ${consumeUnits} unit${consumeUnits === 1 ? '' : 's'}…`,
      )
      const consumed = await consumeGrant(
        resourceId,
        settled.unlockToken,
        consumeUnits,
        http,
      )
      consume = consumeResultFromHttp(resourceId, consumeUnits, consumed)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      notes.push(redactSecrets(`Auto-consume failed: ${message}`))
    }
  }

  return {
    ok: true,
    command: 'pay',
    status: 'settled',
    resourceId,
    potId,
    priceCents,
    network,
    asset,
    sparkTxHash,
    unlockTokenReceived,
    unlockUrl: settled.unlockUrl || undefined,
    metered,
    autoConsume,
    consume,
    notes,
  }
}

/** Human-readable string (stable plain format for tests). */
export async function payResource(
  resourceId: string,
  options: PayResourceOptions = {},
): Promise<string> {
  return formatPayPlain(await payResourceResult(resourceId, options))
}

export interface ConsumeResourceOptions {
  env?: PotEnv
  fetch?: typeof fetch
  log?: (message: string) => void
  /** CLI `--unlock-token`. Env `ZAPPI_UNLOCK_TOKEN` wins when both are set. */
  unlockToken?: string
  units?: number
}

export async function consumeResourceResult(
  resourceId: string,
  options: ConsumeResourceOptions = {},
): Promise<ConsumeResult> {
  const env = options.env ?? process.env
  const units = parsePositiveUnits(
    options.units == null ? undefined : String(options.units),
    1,
  )
  const unlockToken = resolveUnlockToken(env, options.unlockToken)
  const http = httpOptions(env, options)
  const consumed = await consumeGrant(resourceId, unlockToken, units, http)
  return consumeResultFromHttp(resourceId, units, consumed)
}

export async function consumeResource(
  resourceId: string,
  options: ConsumeResourceOptions = {},
): Promise<string> {
  return formatConsumePlain(await consumeResourceResult(resourceId, options))
}

function consumeResultFromHttp(
  resourceId: string,
  units: number,
  consumed: { status: number; body: unknown },
): ConsumeResult {
  if (consumed.status === 200) {
    const remaining = grantRemainingFromBody(consumed.body)
    return {
      ok: true,
      command: 'consume',
      resourceId,
      units,
      grantRemaining: remaining,
    }
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
