import { DEFAULT_ZAPPI_APP_ORIGIN } from './env.js'
import {
  isSparkAddressForNetwork,
  looksLikeMnemonicPhrase,
  type SparkNetworkEnv,
} from './spark-address.js'

export { DEFAULT_ZAPPI_APP_ORIGIN }

/** Matches web `POT_MODES`: free = auth not required, auth_required = approve spends. */
export const POT_SPEND_MODES = ['free', 'auth_required'] as const
export type PotSpendMode = (typeof POT_SPEND_MODES)[number]

export function parsePotSpendMode(raw?: string | null): PotSpendMode | null {
  if (raw === 'free' || raw === 'auth_required') return raw
  return null
}

export type RegisterDeepLinkStatus = 'empty' | 'ok' | 'mnemonic' | 'invalid'

export interface RegisterDeepLinkEmpty {
  status: 'empty'
}

export interface RegisterDeepLinkOk {
  status: 'ok'
  sparkAddress: string
  label?: string
}

export interface RegisterDeepLinkRejected {
  status: 'mnemonic' | 'invalid'
}

export type RegisterDeepLinkParse =
  | RegisterDeepLinkEmpty
  | RegisterDeepLinkOk
  | RegisterDeepLinkRejected

export interface RegisterDeepLinkQuery {
  register?: string | null
  label?: string | null
  ref?: string | null
  invite?: string | null
}

export interface BuildRegisterDeepLinkInput {
  sparkAddress: string
  label?: string | null
  origin?: string | null
  network?: SparkNetworkEnv
  /** `free` (default) = auth not required; `auth_required` = approve in Zappi. */
  mode?: PotSpendMode
  /** Crockford invite code the caller already has. Propose does not mint one. */
  ref?: string | null
}

/** Nest Crockford alphabet, length 4–16. Same shape as the web invite parser. */
const INVITE_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4,16}$/i

/**
 * Invite code for a register link. Empty, mnemonic, or non-Crockford → null.
 * Does not invent a code.
 */
export function parseInviteRef(raw?: string | null): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed || looksLikeMnemonicPhrase(trimmed)) return null
  if (!INVITE_CODE_RE.test(trimmed)) return null
  return trimmed.toUpperCase()
}

/** `--ref` must be a code the caller already has. Mnemonic or junk throws. */
export function requireInviteRef(raw: string): string {
  if (looksLikeMnemonicPhrase(raw.trim())) {
    throw new Error(
      'Do not pass a recovery phrase as --ref. Pass the invite code you already have.',
    )
  }
  const code = parseInviteRef(raw)
  if (!code) {
    throw new Error(
      'Pass an invite code you already have as --ref. Propose does not invent one.',
    )
  }
  return code
}

/** Read `--ref <code>` from argv. Missing flag → undefined. Bad code throws. */
export function inviteRefFromArgv(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--ref') continue
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      throw new Error(
        'Pass an invite code you already have as --ref. Propose does not invent one.',
      )
    }
    return requireInviteRef(next)
  }
  return undefined
}

function isLikelySparkAddress(
  value: string,
  network: SparkNetworkEnv = 'MAINNET',
): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 20 || trimmed.length > 200) return false
  if (/\s/.test(trimmed)) return false
  if (looksLikeMnemonicPhrase(trimmed)) return false
  return isSparkAddressForNetwork(trimmed, network)
}

function sanitizeLabel(value?: string | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.replace(/[\r\n]/g, ' ').trim()
  if (!trimmed || trimmed.length > 64) return undefined
  if (looksLikeMnemonicPhrase(trimmed)) return undefined
  return trimmed
}

export function safeAppOrigin(origin?: string | null): string {
  if (!origin) return DEFAULT_ZAPPI_APP_ORIGIN
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_ZAPPI_APP_ORIGIN
    }
    return url.origin
  } catch {
    return DEFAULT_ZAPPI_APP_ORIGIN
  }
}

/**
 * Parse a public spark address for the P0 pots attach deep link.
 * BIP-39 phrases are rejected — never put a recovery phrase in a URL.
 */
export function parseRegisterDeepLinkQuery(
  query: RegisterDeepLinkQuery,
  network: SparkNetworkEnv = 'MAINNET',
): RegisterDeepLinkParse {
  const raw = typeof query.register === 'string' ? query.register.trim() : ''
  if (!raw) return { status: 'empty' }
  if (looksLikeMnemonicPhrase(raw)) return { status: 'mnemonic' }
  if (!isLikelySparkAddress(raw, network)) return { status: 'invalid' }

  const label = sanitizeLabel(query.label)
  return {
    status: 'ok',
    sparkAddress: raw,
    ...(label ? { label } : {}),
  }
}

/**
 * Register deep link for an agent-held pot address.
 * - `mode=free` (default): `/?panel=pots&pots=agent&mode=free&register=…`
 * - `mode=auth_required`: `/?panel=pots&pots=mine&mode=auth_required&register=…`
 * Optional `&label=` and `&ref=` (Crockford invite code only). Returns null
 * when the address is missing, invalid, or a recovery phrase. Never puts a
 * mnemonic or an invented code in the URL.
 */
export function buildRegisterDeepLink(
  input: BuildRegisterDeepLinkInput,
): string | null {
  const sparkAddress = input.sparkAddress.trim()
  const network = input.network ?? 'MAINNET'
  const mode: PotSpendMode = input.mode ?? 'free'
  if (!sparkAddress || looksLikeMnemonicPhrase(sparkAddress)) return null
  if (!isLikelySparkAddress(sparkAddress, network)) return null

  const url = new URL('/', safeAppOrigin(input.origin))
  url.searchParams.set('panel', 'pots')
  url.searchParams.set('pots', mode === 'free' ? 'agent' : 'mine')
  url.searchParams.set('mode', mode)
  url.searchParams.set('register', sparkAddress)
  const label = sanitizeLabel(input.label)
  if (label) url.searchParams.set('label', label)
  const ref = parseInviteRef(input.ref)
  if (ref) url.searchParams.set('ref', ref)
  return url.toString()
}
