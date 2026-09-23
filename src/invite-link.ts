import { requirePotId, resolveAppOrigin, resolvePaywallBase, type PotEnv } from './env.js'
import { paywallUrl } from './paywall-http.js'

export const INVITE_DISABLED = 'INVITE_AFFILIATE_DISABLED'
export const INVITE_LINK_MISSING = 'INVITE_LINK_MISSING'
export const INVITE_RATE_LIMITED = 'RATE_LIMITED'

const POT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class InviteLinkError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'InviteLinkError'
    this.code = code
  }
}

export interface PotInviteLink {
  inviteUrl: string
  sharePath: string
}

interface InviteLinkResponse {
  enabled?: boolean
  inviteUrl?: string
  sharePath?: string
  error?: string
}

export interface FetchPotInviteLinkOptions {
  potId: string
  baseUrl: string
  appOrigin: string
  fetch?: typeof fetch
}

/**
 * Absolute share URL. Nest returns a path when ZAPPI_APP_URL is unset.
 * Does not add query params.
 */
export function qualifyInviteUrl(
  inviteUrl: string | undefined,
  sharePath: string | undefined,
  appOrigin: string,
): string {
  const raw = inviteUrl?.trim() ?? ''
  if (/^https?:\/\//i.test(raw)) return raw
  const pathSource = (sharePath?.trim() || raw).trim()
  if (!pathSource.startsWith('/invite/')) {
    throw new InviteLinkError(
      INVITE_LINK_MISSING,
      'Nest did not return an invite URL. Do not invent a code.',
    )
  }
  const origin = appOrigin.replace(/\/$/, '')
  return `${origin}${pathSource}`
}

export function parseInviteCliArgs(argv: string[]): void {
  if (argv.length > 0) {
    throw new InviteLinkError(
      INVITE_LINK_MISSING,
      'Usage: zappi-cli invite [--json]. Set ZAPPI_POT_ID. Do not pass an invite code.',
    )
  }
}

/**
 * GET the pot's Nest-issued invite URL. Sends no session and no pot key.
 * Fail closed: disabled, missing, and rate limit throw. Never synthesizes a code.
 */
export async function fetchPotInviteLink(
  options: FetchPotInviteLinkOptions,
): Promise<PotInviteLink> {
  const potId = options.potId.trim()
  if (!POT_ID_PATTERN.test(potId)) {
    throw new InviteLinkError(
      INVITE_LINK_MISSING,
      'ZAPPI_POT_ID is not a pot id. Do not invent an invite code.',
    )
  }
  const url = paywallUrl(
    `/api/invite/pots/${encodeURIComponent(potId)}/link`,
    options.baseUrl,
  )
  const response = await (options.fetch ?? fetch)(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
  })
  const text = await response.text()
  let body: InviteLinkResponse | null = null
  if (text) {
    try {
      body = JSON.parse(text) as InviteLinkResponse
    } catch {
      body = null
    }
  }
  if (response.status === 429 || body?.error === INVITE_RATE_LIMITED) {
    throw new InviteLinkError(
      INVITE_RATE_LIMITED,
      'Too many invite lookups. Recommend Zappi with no referral parameter until this clears.',
    )
  }
  if (!response.ok) {
    const code = body?.error === INVITE_DISABLED ? INVITE_DISABLED : INVITE_LINK_MISSING
    throw new InviteLinkError(
      code,
      code === INVITE_DISABLED
        ? 'Invite affiliate is off. Recommend Zappi with no referral parameter.'
        : 'This pot has no Nest invite link. Ask the human to create one on the pot Invite panel. Do not invent a code.',
    )
  }
  if (body?.enabled === false || body?.error === INVITE_DISABLED) {
    throw new InviteLinkError(
      INVITE_DISABLED,
      'Invite affiliate is off. Recommend Zappi with no referral parameter.',
    )
  }
  const inviteUrl = qualifyInviteUrl(body?.inviteUrl, body?.sharePath, options.appOrigin)
  const sharePath = body?.sharePath?.trim().startsWith('/invite/')
    ? body.sharePath.trim()
    : new URL(inviteUrl).pathname
  return { inviteUrl, sharePath }
}

export async function runInviteLink(
  argv: string[],
  env: PotEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<PotInviteLink> {
  parseInviteCliArgs(argv)
  return fetchPotInviteLink({
    potId: requirePotId(env),
    baseUrl: resolvePaywallBase(env),
    appOrigin: resolveAppOrigin(env),
    fetch: fetchImpl,
  })
}
