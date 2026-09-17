import { bech32m } from '@scure/base'

/** Longest HRP first so `sparkrt` is not classified as `spark`. */
export const SPARK_HRPS = [
  'sparkrt',
  'sparkt',
  'sparks',
  'sparkl',
  'spark',
  'sprt',
  'sp',
] as const

export type SparkNetworkEnv = 'MAINNET' | 'REGTEST'

const MAINNET_HRPS = new Set(['spark', 'sp'])
const REGTEST_HRPS = new Set(['sparkrt', 'sprt', 'sparkl'])

export function looksLikeMnemonicPhrase(value: string): boolean {
  const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length < 12 || words.length > 24) return false
  return words.every((word) => /^[a-z]+$/.test(word))
}

export function looksLikeSparkAddress(address: string): boolean {
  const lower = address.trim().toLowerCase()
  return SPARK_HRPS.some((hrp) => lower.startsWith(`${hrp}1`))
}

export function sparkHrp(address: string): string | null {
  const lower = address.trim().toLowerCase()
  return SPARK_HRPS.find((hrp) => lower.startsWith(`${hrp}1`)) ?? null
}

export type SparkDecodedNetwork = SparkNetworkEnv | 'FOREIGN'

export function sparkNetworkFromHrp(hrp: string): SparkDecodedNetwork | null {
  if (MAINNET_HRPS.has(hrp)) return 'MAINNET'
  if (REGTEST_HRPS.has(hrp)) return 'REGTEST'
  if (hrp === 'sparkt' || hrp === 'sparks') return 'FOREIGN'
  return null
}

export interface InspectedSparkAddress {
  valid: boolean
  network: SparkDecodedNetwork | null
}

export function inspectSparkAddress(address: string): InspectedSparkAddress {
  const trimmed = address.trim()
  if (!looksLikeSparkAddress(trimmed)) {
    return { valid: false, network: null }
  }

  const decoded = bech32m.decodeUnsafe(trimmed.toLowerCase(), 128)
  if (!decoded) {
    const hrp = sparkHrp(trimmed)
    return {
      valid: false,
      network: hrp ? sparkNetworkFromHrp(hrp) : null,
    }
  }

  const network = sparkNetworkFromHrp(decoded.prefix)
  const program = bech32m.fromWordsUnsafe(decoded.words)
  if (!network || !program || program.length < 16) {
    return { valid: false, network }
  }
  return { valid: true, network }
}

export function isSparkAddressForNetwork(
  address: string,
  network: SparkNetworkEnv,
): boolean {
  const inspected = inspectSparkAddress(address)
  return inspected.valid && inspected.network === network
}
