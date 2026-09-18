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
    const tokenBalances = balance.tokenBalances ?? {}
    for (const tokenIdentifier of Object.keys(tokenBalances)) {
      if (tokenIdentifier.startsWith('btkn')) return tokenIdentifier
    }
    throw new Error(EMPTY_POT_ERROR)
  } finally {
    await wallet.cleanupConnections()
  }
}
