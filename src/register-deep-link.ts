import {
  isSparkAddressForNetwork,
  looksLikeMnemonicPhrase,
  type SparkNetworkEnv,
} from './spark-address.js'

/** Production app origin. CLI/docs default. */
export const DEFAULT_ZAPPI_APP_ORIGIN = 'https://zappi.money'

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
}

export interface BuildRegisterDeepLinkInput {
  sparkAddress: string
  label?: string | null
  origin?: string | null
  network?: SparkNetworkEnv
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
 * Free-mode attach: `/?panel=pots&pots=agent&mode=free&register=<sparkAddress>`
 * (optional `&label=`). Returns null when the address is missing, invalid, or
 * a recovery phrase. No pot mnemonic UI — the agent already holds the key.
 */
export function buildRegisterDeepLink(
  input: BuildRegisterDeepLinkInput,
): string | null {
  const sparkAddress = input.sparkAddress.trim()
  const network = input.network ?? 'MAINNET'
  if (!sparkAddress || looksLikeMnemonicPhrase(sparkAddress)) return null
  if (!isLikelySparkAddress(sparkAddress, network)) return null

  const url = new URL('/', safeAppOrigin(input.origin))
  url.searchParams.set('panel', 'pots')
  url.searchParams.set('pots', 'agent')
  url.searchParams.set('mode', 'free')
  url.searchParams.set('register', sparkAddress)
  const label = sanitizeLabel(input.label)
  if (label) url.searchParams.set('label', label)
  return url.toString()
}
