import { DEFAULT_ZAPPI_API_URL } from './env.js'
import { looksLikeMnemonicPhrase } from './spark-address.js'

export const DEFAULT_PAYWALL_BASE = DEFAULT_ZAPPI_API_URL

export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export const BACKOFF_MS = [1000, 2000, 4000, 8000] as const

export const DEFAULT_DEADLINE_MS = 120_000

export interface PaywallClock {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export interface PaywallHttpOptions {
  baseUrl?: string
  fetch?: typeof fetch
  clock?: PaywallClock
  deadlineMs?: number
  log?: (message: string) => void
}

export interface PaywallResponse<T> {
  status: number
  body: T | null
  rawText: string
}

export function paywallUrl(
  path: string,
  baseUrl = DEFAULT_PAYWALL_BASE,
): string {
  return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export function nextBackoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 8000
}

export function shouldRetrySettle(status: number): boolean {
  return status === 402 || RETRYABLE_STATUS.has(status)
}

export function redactSecrets(text: string): string {
  const redacted = text
    .replace(/zpu_[A-Za-z0-9]+/g, 'zpu_[redacted]')
    .replace(/zpc_[A-Za-z0-9_-]+/g, 'zpc_[redacted]')
    .replace(/ZAPPI_POT_SEED=\S+/g, 'ZAPPI_POT_SEED=[redacted]')
    .replace(/ZAPPI_POT_CLIENT_TOKEN=\S+/g, 'ZAPPI_POT_CLIENT_TOKEN=[redacted]')
    .replace(/ZAPPI_UNLOCK_TOKEN=\S+/g, 'ZAPPI_UNLOCK_TOKEN=[redacted]')
    .replace(
      /x-zappi-pot-client:\s*\S+/gi,
      'x-zappi-pot-client: [redacted]',
    )
    .replace(
      /X-Zappi-Unlock-Token:\s*\S+/gi,
      'X-Zappi-Unlock-Token: [redacted]',
    )
    .replace(/X-Zappi-Payment:\s*\S+/gi, 'X-Zappi-Payment: [redacted]')
  return redacted.replace(/\b(?:[A-Za-z]+(?:\s+|$)){12,24}/g, (match) => {
    const trimmed = match.trim()
    return looksLikeMnemonicPhrase(trimmed) ? '[redacted mnemonic]' : match
  })
}

export function shapeSettleBody(input: {
  sparkTxHash: string
  potId: string
  idempotencyKey?: string
}): { sparkTxHash: string; potId: string; idempotencyKey?: string } {
  return {
    sparkTxHash: input.sparkTxHash,
    potId: input.potId,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  }
}

export function shapeConsumeBody(units: number): { units: number } {
  return { units }
}

function defaultClock(): PaywallClock {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

async function readResponse(
  response: Response,
): Promise<PaywallResponse<unknown>> {
  const rawText = await response.text()
  let body: unknown = null
  if (rawText) {
    try {
      body = JSON.parse(rawText)
    } catch {
      body = null
    }
  }
  return { status: response.status, body, rawText }
}

export async function fetchPaywall(
  path: string,
  init: RequestInit,
  options: PaywallHttpOptions = {},
): Promise<PaywallResponse<unknown>> {
  const fetchImpl = options.fetch ?? fetch
  const url = paywallUrl(path, options.baseUrl)
  const response = await fetchImpl(url, init)
  return readResponse(response)
}

export async function getResource(
  resourceId: string,
  options: PaywallHttpOptions = {},
  unlockToken?: string,
): Promise<PaywallResponse<unknown>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (unlockToken) headers['X-Zappi-Unlock-Token'] = unlockToken
  return fetchPaywall(
    `/api/paywall/resources/${encodeURIComponent(resourceId)}`,
    { headers },
    options,
  )
}

export interface SettleInput {
  resourceId: string
  potId: string
  sparkTxHash: string
  idempotencyKey?: string
}

export interface SettleResult {
  status: number
  firstUnlock: boolean
  unlockToken: string | null
  unlockUrl?: string
  body: unknown
}

/**
 * POST settle with backoff. Same hash only. 402 means the tx is not
 * visible yet. Replay is safe. Never writes the unlock token to `log`.
 */
export async function settleWithRetry(
  input: SettleInput,
  options: PaywallHttpOptions = {},
): Promise<SettleResult> {
  const clock = options.clock ?? defaultClock()
  const deadline = clock.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS)
  let attempt = 0
  let last: PaywallResponse<unknown> | null = null
  const body = shapeSettleBody(input)

  while (clock.now() < deadline) {
    last = await fetchPaywall(
      `/api/paywall/resources/${encodeURIComponent(input.resourceId)}/settle`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      options,
    )

    if (last.status === 200) {
      const record =
        last.body && typeof last.body === 'object'
          ? (last.body as Record<string, unknown>)
          : {}
      const token =
        typeof record.unlockToken === 'string' ? record.unlockToken : null
      options.log?.(
        'Settled paywall resource. Unlock token withheld from logs.',
      )
      return {
        status: 200,
        firstUnlock: record.firstUnlock === true,
        unlockToken: token,
        unlockUrl:
          typeof record.unlockUrl === 'string' ? record.unlockUrl : undefined,
        body: last.body,
      }
    }

    if (!shouldRetrySettle(last.status)) {
      options.log?.(redactSecrets(`Settle stopped with HTTP ${last.status}`))
      return {
        status: last.status,
        firstUnlock: false,
        unlockToken: null,
        body: last.body,
      }
    }

    const wait = nextBackoffMs(attempt)
    attempt += 1
    options.log?.(`Settle HTTP ${last.status}; retry in ${wait}ms`)
    await clock.sleep(wait)
  }

  return {
    status: last?.status ?? 408,
    firstUnlock: false,
    unlockToken: null,
    body: last?.body ?? null,
  }
}

export async function consumeGrant(
  resourceId: string,
  unlockToken: string,
  units = 1,
  options: PaywallHttpOptions = {},
): Promise<PaywallResponse<unknown>> {
  return fetchPaywall(
    `/api/paywall/resources/${encodeURIComponent(resourceId)}/consume`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Zappi-Unlock-Token': unlockToken,
      },
      body: JSON.stringify(shapeConsumeBody(units)),
    },
    options,
  )
}
