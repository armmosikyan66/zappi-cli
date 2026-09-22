import type { Bech32mTokenIdentifier } from '@buildonspark/spark-sdk'

export const USDB_MICRO_UNITS_PER_CENT = 10_000

export const EMPTY_POT_ERROR =
  'Pot has no USDB balance. Fund the pot before paying a resource.'

export interface SendUsdbFromPotInput {
  mnemonic: string
  accountNumber: number
  network: 'MAINNET' | 'REGTEST'
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
  network: 'MAINNET' | 'REGTEST',
): Promise<string> {
  const { SparkWallet } = await import('@buildonspark/spark-sdk')
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: mnemonic,
    accountNumber,
    options: { network },
  })

  try {
    const balance = await wallet.getBalance()
    const tokenIdentifier = pickUsdbTokenIdentifier(balance.tokenBalances)
    if (!tokenIdentifier) throw new Error(EMPTY_POT_ERROR)
    return tokenIdentifier
  } finally {
    await wallet.cleanupConnections()
  }
}
