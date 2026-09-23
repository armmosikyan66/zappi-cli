import {
  requirePotId,
  resolveAppOrigin,
  resolvePaywallBase,
  resolvePotClientToken,
  type PotEnv,
} from './env.js'
import { fetchPaywall, redactSecrets } from './paywall-http.js'
import { looksLikeMnemonicPhrase } from './spark-address.js'

export const REQUEST_USAGE =
  'Usage: zappi-cli request --amount-cents <cents> --to <spark-address> [--chain <chain>] [--memo <text>] [--json]'

const SECRET_FLAG_MESSAGE =
  'Do not pass a session token, pot seed, or recovery phrase. Set ZAPPI_POT_CLIENT_TOKEN as a host secret and paste only the approve URL.'

const SECRET_FLAGS = new Set([
  '--seed',
  '--mnemonic',
  '--phrase',
  '--recovery',
  '--access-token',
  '--session-token',
  '--client-token',
  '--pot-seed',
  '--unlock-token',
])

export interface RequestCliArgs {
  amountCents: number
  destinationAddress: string
  destinationChain?: string
  memo?: string
}

export interface SpendRequestResult {
  ok: true
  command: 'request'
  potId: string
  requestId: string
  approveUrl: string
  amountCents: number
  destinationAddress: string
}

export interface CreateSpendRequestOptions {
  env?: PotEnv
  fetch?: typeof fetch
  log?: (message: string) => void
  input: RequestCliArgs
}

/** Bare approve link. No user code. Not the attach `approveUrl` builder. */
export function buildSpendApproveUrl(
  requestId: string,
  origin: string,
): string {
  const url = new URL('/', origin)
  url.searchParams.set('panel', 'pots')
  url.searchParams.set('spend', requestId)
  return url.toString()
}

export function parseRequestCliArgs(argv: string[]): RequestCliArgs {
  let amountRaw: string | undefined
  let destination: string | undefined
  let destinationChain: string | undefined
  let memo: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (!arg) continue
    if (arg === '--help' || arg === '-h') {
      throw new Error(REQUEST_USAGE)
    }
    if (SECRET_FLAGS.has(arg)) {
      throw new Error(SECRET_FLAG_MESSAGE)
    }
    if (arg === '--amount-cents' && next) {
      amountRaw = next
      index += 1
      continue
    }
    if (arg === '--to' && next) {
      destination = next
      index += 1
      continue
    }
    if (arg === '--chain' && next) {
      destinationChain = next
      index += 1
      continue
    }
    if (arg === '--memo' && next) {
      memo = next
      index += 1
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}\n\n${REQUEST_USAGE}`)
    }
    throw new Error(REQUEST_USAGE)
  }

  const amountCents = parseAmountCents(amountRaw)
  const destinationAddress = destination?.trim() ?? ''
  if (!destinationAddress) {
    throw new Error(REQUEST_USAGE)
  }
  rejectPhrase(destinationAddress)
  if (memo) rejectPhrase(memo)
  if (destinationChain) rejectPhrase(destinationChain)

  return {
    amountCents,
    destinationAddress,
    destinationChain: destinationChain?.trim() || undefined,
    memo: memo?.trim() || undefined,
  }
}

/**
 * POST a spend ticket with the pot client token. Prints nothing itself.
 * Stdout callers must emit `approveUrl` only — never the token.
 */
export async function createSpendRequestResult(
  options: CreateSpendRequestOptions,
): Promise<SpendRequestResult> {
  const env = options.env ?? process.env
  const potId = requirePotId(env)
  const clientToken = resolvePotClientToken(env)
  const { input } = options
  const body: Record<string, unknown> = {
    amountCents: input.amountCents,
    destinationAddress: input.destinationAddress,
  }
  if (input.destinationChain) body.destinationChain = input.destinationChain
  if (input.memo) body.memo = input.memo

  const response = await fetchPaywall(
    `/api/wallet/self-custody/pots/${encodeURIComponent(potId)}/spend-requests`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-zappi-pot-client': clientToken,
      },
      body: JSON.stringify(body),
    },
    {
      baseUrl: resolvePaywallBase(env),
      fetch: options.fetch,
      log: options.log
        ? (message) => options.log?.(redactSecrets(message))
        : undefined,
    },
  )

  if (response.status !== 201 && response.status !== 200) {
    throw new Error(
      redactSecrets(
        `Spend request failed (${response.status}): ${messageFromBody(response.body, 'unknown error')}`,
      ),
    )
  }

  const record =
    response.body && typeof response.body === 'object'
      ? (response.body as Record<string, unknown>)
      : {}
  const requestId = typeof record.id === 'string' ? record.id.trim() : ''
  if (!requestId || looksLikeMnemonicPhrase(requestId)) {
    throw new Error('Spend ticket response had no id.')
  }

  const approveUrl = bareApproveUrl(
    typeof record.approveUrl === 'string' ? record.approveUrl : undefined,
    requestId,
    resolveAppOrigin(env),
  )
  assertPrintableUrl(approveUrl, clientToken)

  return {
    ok: true,
    command: 'request',
    potId,
    requestId,
    approveUrl,
    amountCents: input.amountCents,
    destinationAddress: input.destinationAddress,
  }
}

/** Agent stdout. Pretty and plain are the URL alone so a chat agent can paste it. */
export function formatSpendRequestOutput(
  result: SpendRequestResult,
  mode: 'pretty' | 'plain' | 'json',
): string {
  if (mode === 'json') {
    return JSON.stringify(
      {
        ok: result.ok,
        command: result.command,
        potId: result.potId,
        requestId: result.requestId,
        approveUrl: result.approveUrl,
        amountCents: result.amountCents,
        destinationAddress: result.destinationAddress,
      },
      null,
      2,
    )
  }
  return result.approveUrl
}

function parseAmountCents(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') {
    throw new Error(REQUEST_USAGE)
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('--amount-cents must be a positive integer (100 = $1).')
  }
  return parsed
}

function rejectPhrase(value: string): void {
  if (looksLikeMnemonicPhrase(value)) {
    throw new Error(
      'Do not pass a recovery phrase. Pass the destination address and paste the approve URL.',
    )
  }
}

function bareApproveUrl(
  raw: string | undefined,
  requestId: string,
  origin: string,
): string {
  const built = buildSpendApproveUrl(requestId, origin)
  if (!raw?.trim()) return built
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return built
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return built
  url.searchParams.delete('code')
  const spend = url.searchParams.get('spend')?.trim() ?? ''
  if (!spend || looksLikeMnemonicPhrase(spend)) return built
  if (spend !== requestId) url.searchParams.set('spend', requestId)
  url.searchParams.delete('code')
  return url.toString()
}

function assertPrintableUrl(approveUrl: string, clientToken: string): void {
  let url: URL
  try {
    url = new URL(approveUrl)
  } catch {
    throw new Error('Spend ticket did not return a printable approve URL.')
  }
  if (url.searchParams.has('code') || /[?&]code=/.test(approveUrl)) {
    throw new Error('Refusing to print an approve URL that includes a user code.')
  }
  if (
    approveUrl.includes(clientToken) ||
    /zpc_[A-Za-z0-9_-]+/.test(approveUrl)
  ) {
    throw new Error(
      'Refusing to print an approve URL that carries a pot client token.',
    )
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    return String((body as { message: unknown }).message)
  }
  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as { error: unknown }).error)
  }
  return fallback
}
