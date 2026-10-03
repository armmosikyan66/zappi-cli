import type { Bech32mTokenIdentifier } from '@buildonspark/spark-sdk'

export const USDB_MICRO_UNITS_PER_CENT = 10_000
/** USDB is 6 decimals, 1:1 with USD. 1 cent = 10_000 base units. */
export const USDB_DECIMALS = 6

export const EMPTY_POT_ERROR =
  'Pot has no USDB balance. Fund the pot before paying a resource.'

export interface SendUsdbFromPotInput {
  mnemonic: string
  accountNumber: number
  network: 'MAINNET'
  tokenIdentifier: string
  receiverSparkAddress: string
  amountCents: number
}

export interface SendUsdbFromPotResult {
  sparkTxHash: string
}

/**
 * First `btkn…` identifier in a Spark token-balance Map or plain object.
 * Spark SDK returns a Map on REGTEST/MAINNET; Object.keys alone misses those.
 */
export function pickUsdbTokenIdentifier(tokenBalances: unknown): string | null {
  if (!tokenBalances || typeof tokenBalances !== 'object') return null
  const keys =
    tokenBalances instanceof Map
      ? [...tokenBalances.keys()].map(String)
      : Object.keys(tokenBalances as Record<string, unknown>)
  for (const tokenIdentifier of keys) {
    if (tokenIdentifier.startsWith('btkn')) return tokenIdentifier
  }
  return null
}

function tokenHrpNetwork(tokenIdentifier: string): 'MAINNET' | null {
  if (tokenIdentifier.startsWith('btkn1')) return 'MAINNET'
  return null
}

function tokenMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const nested = record.tokenMetadata ?? record.tokenInfo ?? record.metadata
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  return record
}

function textField(meta: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/**
 * The one USDB token on `network`. Ticker must be USDB, decimals must be 6,
 * and the identifier HRP (plus any metadata network) must match the pot.
 * The first `btkn` key is not enough. Missing or contradictory metadata throws
 * before any signer call.
 */
export function selectCanonicalUsdbToken(
  tokenBalances: unknown,
  network: 'MAINNET',
): string {
  const matches: string[] = []
  for (const [tokenIdentifier, value] of tokenBalanceEntries(tokenBalances)) {
    const hrpNetwork = tokenHrpNetwork(tokenIdentifier)
    if (!hrpNetwork) continue
    const meta = tokenMetadata(value)
    const ticker = textField(meta, ['tokenTicker', 'ticker', 'symbol'])
    const name = textField(meta, ['tokenName', 'name'])
    const label = (ticker ?? name ?? '').toUpperCase()
    if (label !== 'USDB') continue
    const decimals = meta.decimals
    if (typeof decimals !== 'number' || decimals !== USDB_DECIMALS) {
      throw new Error(
        `USDB token ${tokenIdentifier} decimals are ${String(decimals)}; expected ${USDB_DECIMALS}. Refusing to sign.`,
      )
    }
    const metaNetwork = textField(meta, ['network'])?.toUpperCase()
    if (metaNetwork && metaNetwork !== network) {
      throw new Error(
        `USDB token ${tokenIdentifier} metadata network is ${metaNetwork} but the pot network is ${network}. Refusing to sign.`,
      )
    }
    if (hrpNetwork !== network) {
      throw new Error(
        `USDB token ${tokenIdentifier} is a ${hrpNetwork} identifier but the pot network is ${network}. Refusing to sign.`,
      )
    }
    matches.push(tokenIdentifier)
  }
  if (matches.length === 0) {
    throw new Error(
      'No canonical USDB token (ticker USDB, 6 decimals, matching network) in the pot balance. Refusing to sign.',
    )
  }
  if (matches.length > 1) {
    throw new Error('More than one canonical USDB token. Refusing to sign.')
  }
  const selected = matches[0]
  if (!selected) throw new Error('No canonical USDB token. Refusing to sign.')
  return selected
}

/** Normalize Spark tokenBalances (Map or record) to string entries. */
export function tokenBalanceEntries(
  tokenBalances: unknown,
): Array<[string, unknown]> {
  if (!tokenBalances || typeof tokenBalances !== 'object') return []
  if (tokenBalances instanceof Map) {
    return [...tokenBalances.entries()].map(([k, v]) => [String(k), v])
  }
  return Object.entries(tokenBalances as Record<string, unknown>)
}

export async function sendUsdbFromPot(
  input: SendUsdbFromPotInput,
): Promise<SendUsdbFromPotResult> {
  if (input.amountCents <= 0) {
    throw new Error('Price must be greater than zero.')
  }
  const tokenAmount =
    BigInt(input.amountCents) * BigInt(USDB_MICRO_UNITS_PER_CENT)

  const { SparkWallet } = await import('@buildonspark/spark-sdk')
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: input.mnemonic,
    accountNumber: input.accountNumber,
    options: { network: input.network },
  })

  try {
    const sparkTxHash = await wallet.transferTokens({
      tokenIdentifier: input.tokenIdentifier as Bech32mTokenIdentifier,
      tokenAmount,
      receiverSparkAddress: input.receiverSparkAddress,
    })
    return { sparkTxHash }
  } finally {
    await wallet.cleanupConnections()
  }
}

export async function readUsdbTokenIdentifier(
  mnemonic: string,
  accountNumber: number,
  network: 'MAINNET',
): Promise<string> {
  const { SparkWallet } = await import('@buildonspark/spark-sdk')
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: mnemonic,
    accountNumber,
    options: { network },
  })

  try {
    const balance = await wallet.getBalance()
    return selectCanonicalUsdbToken(balance.tokenBalances, network)
  } finally {
    await wallet.cleanupConnections()
  }
}
