/** Nest x402 402 `accepts[0]` today (`X402_NETWORK` / `X402_ASSET`). */
export const PAYABLE_PAYWALL_NETWORK = 'spark'
export const PAYABLE_PAYWALL_ASSET = 'USDB'

export interface PaywallAcceptExtra {
  priceCents?: number
  pricingMode?: string
  unlockMode?: string
  settlePath?: string
  consumePath?: string
  payToSparkAddress?: string
}

export interface PaywallAccept {
  scheme?: string
  network?: string
  asset?: string
  payTo?: string
  maxAmountRequired?: string
  extra?: PaywallAcceptExtra
}

export interface PaywallChallenge {
  x402Version?: number
  accepts?: PaywallAccept[]
}

export interface SelectedPaywallAccept {
  payTo: string
  priceCents: number
  network: string
  asset: string
  accept: PaywallAccept
}

export function isMeteredPricing(accept: PaywallAccept): boolean {
  const pricingMode = accept.extra?.pricingMode?.trim().toLowerCase()
  const unlockMode = accept.extra?.unlockMode?.trim().toLowerCase()
  return pricingMode === 'metered' || unlockMode === 'metered_grant'
}

function field(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Read nest/paywall 402 `accepts[0]`. Never infer network or asset from
 * `payTo` shape. Refuse rails this CLI cannot pay (Spark USDB only).
 */
export function pickPaywallAccept(
  challenge: PaywallChallenge,
): SelectedPaywallAccept {
  const accept = challenge.accepts?.[0]
  if (!accept?.payTo?.trim()) {
    throw new Error('402 response missing accepts[0].payTo')
  }
  const priceCents = accept.extra?.priceCents
  if (typeof priceCents !== 'number' || priceCents <= 0) {
    throw new Error('402 response missing extra.priceCents')
  }

  const network = field(accept.network)
  const asset = field(accept.asset)
  if (!network) {
    throw new Error(
      '402 response missing accepts[0].network. Do not invent a chain.',
    )
  }
  if (!asset) {
    throw new Error(
      '402 response missing accepts[0].asset. Do not invent an asset.',
    )
  }

  const networkOk = network.toLowerCase() === PAYABLE_PAYWALL_NETWORK
  const assetOk = asset.toUpperCase() === PAYABLE_PAYWALL_ASSET
  if (!networkOk || !assetOk) {
    throw new Error(
      `402 accept is ${network}/${asset}; this CLI can only pay ${PAYABLE_PAYWALL_NETWORK}/${PAYABLE_PAYWALL_ASSET}. Do not send on another chain.`,
    )
  }

  return {
    payTo: accept.payTo.trim(),
    priceCents,
    network: PAYABLE_PAYWALL_NETWORK,
    asset: PAYABLE_PAYWALL_ASSET,
    accept,
  }
}
