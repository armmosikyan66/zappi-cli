import {
  relocateAppLink,
  requireAuthRequiredPotAttached,
  requirePotId,
  resolveLinkOrigin,
  resolvePaywallBase,
  type PotEnv,
} from './env.js'
import { paywallUrl } from './paywall-http.js'

export const INVITE_DISABLED = 'INVITE_AFFILIATE_DISABLED'
export const INVITE_LINK_MISSING = 'INVITE_LINK_MISSING'
export const INVITE_RATE_LIMITED = 'RATE_LIMITED'

const POT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ignore shorter strings so a request id cannot be treated as a credential. */
const MIN_SECRET_NEEDLE = 8

function secretNeedles(secrets: readonly string[] | undefined): string[] {
  const needles: string[] = []
  for (const secret of secrets ?? []) {
    const value = secret.trim()
    if (value.length >= MIN_SECRET_NEEDLE) needles.push(value)
  }
  return needles
}

function paramCarriesCredential(
  key: string,
  value: string,
  needles: readonly string[],
): boolean {
  const keyLower = key.toLowerCase()
  if (keyLower === 'code' || keyLower === 'devicecode') return true
  if (/zpc_[A-Za-z0-9_-]+/i.test(key) || /zpc_[A-Za-z0-9_-]+/i.test(value)) {
    return true
  }
  if (keyLower.includes('devicecode') || value.toLowerCase().includes('devicecode')) {
    return true
  }
  return needles.some((needle) => key.includes(needle) || value.includes(needle))
}

/**
 * Absolute http(s) URL. A relative link is resolved against `base` and never
 * returned raw — an unparseable string can still carry `code=` or `zpc_`.
 */
export function parsePrintableHttpUrl(href: string, base?: string | null): URL {
  const trimmed = href.trim()
  let url: URL | null = null
  try {
    url = new URL(trimmed)
  } catch {
    if (base?.trim()) {
      try {
        url = new URL(trimmed, base.trim())
      } catch {
        url = null
      }
    }
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('Refusing to print a URL that is not a valid http(s) link.')
  }
  return url
}

/** Drop userinfo, `code=`, `deviceCode`, `zpc_`, and any known secret value. */
export function scrubCredentialUrl(url: URL, secrets?: readonly string[]): void {
  url.username = ''
  url.password = ''
  const needles = secretNeedles(secrets)
  const drop: string[] = []
  for (const [key, value] of url.searchParams) {
    if (paramCarriesCredential(key, value, needles)) drop.push(key)
  }
  for (const key of drop) url.searchParams.delete(key)
  const hash = url.hash
  const decodedHash = decodeHash(hash)
  if (
    hash &&
    (/code=/i.test(hash) ||
      /code=/i.test(decodedHash) ||
      /devicecode/i.test(hash) ||
      /devicecode/i.test(decodedHash) ||
      /zpc_[A-Za-z0-9_-]+/i.test(hash) ||
      /zpc_[A-Za-z0-9_-]+/i.test(decodedHash) ||
      needles.some((needle) => hash.includes(needle) || decodedHash.includes(needle)))
  ) {
    url.hash = ''
  }
}

function decodeHash(hash: string): string {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

function decodedForms(href: string): string[] {
  const forms = [href]
  try {
    const decoded = decodeURIComponent(href)
    if (decoded !== href) forms.push(decoded)
  } catch {
    // Keep the raw string when it is not percent-encoded.
  }
  return forms
}

/**
 * Same refuse-to-print rule as spend-request `assertPrintableUrl`: no `code=`,
 * no `zpc_`, and no device code. The message never includes the URL.
 */
export function assertCredentialFreeUrl(href: string, secrets?: readonly string[]): void {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    throw new Error('Refusing to print a URL that is not a valid http(s) link.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Refusing to print a URL that is not a valid http(s) link.')
  }
  if (url.username || url.password) {
    throw new Error('Refusing to print a URL that includes a credential.')
  }
  const needles = secretNeedles(secrets)
  const haystacks = decodedForms(href)
  const carries = (pattern: RegExp): boolean =>
    haystacks.some((haystack) => pattern.test(haystack))
  if (carries(/zpc_[A-Za-z0-9_-]+/i)) {
    throw new Error('Refusing to print a URL that carries a pot client token.')
  }
  if (carries(/devicecode/i)) {
    throw new Error('Refusing to print a URL that includes a device code.')
  }
  if (haystacks.some((haystack) => /(?:^|[?&#/])code=/i.test(haystack))) {
    throw new Error('Refusing to print a URL that includes a user code.')
  }
  if (needles.some((needle) => haystacks.some((haystack) => haystack.includes(needle)))) {
    throw new Error('Refusing to print a URL that carries a credential.')
  }
}

/** Scrub, optionally relocate onto the app origin, then refuse if anything remains. */
export function finishCredentialFreeUrl(
  url: URL,
  appOrigin?: string | null,
  secrets?: readonly string[],
): string {
  scrubCredentialUrl(url, secrets)
  const printed = appOrigin?.trim()
    ? relocateAppLink(url.toString(), appOrigin)
    : url.toString()
  assertCredentialFreeUrl(printed, secrets)
  return printed
}

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

function asInviteLinkError(error: unknown): InviteLinkError {
  if (error instanceof InviteLinkError) return error
  const message =
    error instanceof Error ? error.message : 'Refusing to print an invite URL.'
  return new InviteLinkError(INVITE_LINK_MISSING, message)
}

/**
 * Absolute share URL. Nest returns a path when ZAPPI_APP_URL is unset.
 * Relocates onto the app origin and drops `code=`, `deviceCode`, and `zpc_`.
 * Does not add query params. Never returns the raw Nest string.
 */
export function qualifyInviteUrl(
  inviteUrl: string | undefined,
  sharePath: string | undefined,
  appOrigin: string,
  secrets?: readonly string[],
): string {
  try {
    const raw = inviteUrl?.trim() ?? ''
    if (/^https?:\/\//i.test(raw)) {
      const url = parsePrintableHttpUrl(raw, appOrigin)
      return finishCredentialFreeUrl(url, appOrigin, secrets)
    }
    const pathSource = (sharePath?.trim() || raw).trim()
    if (!pathSource.startsWith('/invite/')) {
      throw new InviteLinkError(
        INVITE_LINK_MISSING,
        'Nest did not return an invite URL. Do not invent a code.',
      )
    }
    const url = parsePrintableHttpUrl(pathSource, appOrigin)
    return finishCredentialFreeUrl(url, appOrigin, secrets)
  } catch (error) {
    throw asInviteLinkError(error)
  }
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
  const sharePath = publicInviteSharePath(inviteUrl, body?.sharePath, options.appOrigin)
  return { inviteUrl, sharePath }
}

/** Pathname only. A `?code=` or `deviceCode` on Nest's sharePath is not printed. */
function publicInviteSharePath(
  inviteUrl: string,
  sharePath: string | undefined,
  appOrigin: string,
): string {
  const fromInvite = new URL(inviteUrl).pathname
  if (fromInvite.startsWith('/invite/')) return fromInvite
  const raw = sharePath?.trim() ?? ''
  if (!raw.startsWith('/invite/')) {
    throw new InviteLinkError(
      INVITE_LINK_MISSING,
      'Nest did not return an invite URL. Do not invent a code.',
    )
  }
  const pathname = new URL(qualifyInviteUrl(undefined, raw, appOrigin)).pathname
  if (!pathname.startsWith('/invite/')) {
    throw new InviteLinkError(
      INVITE_LINK_MISSING,
      'Nest did not return an invite URL. Do not invent a code.',
    )
  }
  return pathname
}

export async function runInviteLink(
  argv: string[],
  env: PotEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<PotInviteLink> {
  parseInviteCliArgs(argv)
  requireAuthRequiredPotAttached(env)
  return fetchPotInviteLink({
    potId: requirePotId(env),
    baseUrl: resolvePaywallBase(env),
    appOrigin: resolveLinkOrigin(env),
    fetch: fetchImpl,
  })
}
