import {
  depositQrPayload,
  nestSourceTokenMeta,
  parseCashierCombo,
  type DepositCombo,
} from '@zappimoney/zappi-sdk'
import { heading, kv, paint, type OutputMode } from './ui.js'
import { renderTerminalQr } from './terminal-qr.js'

const NL = '\n'

export interface DepositCard {
  title: string
  address: string
  /**
   * Server scan string. When set, the QR encodes this and not a locally
   * derived payload. Omit it for older results that only have an address.
   */
  qrPayload?: string
  sourceAsset?: string | null
  sourceChain?: string | null
  sourceToken?: unknown
  fields: Array<[label: string, value: string]>
}

interface PotDepositSource {
  depositAddress: string
  sourceAsset?: string | null
  sourceChain?: string | null
  sourceToken?: unknown
  /** Server scan string. Used as-is when non-empty. */
  qrPayload?: string | null
}

/**
 * Scan payload for a pot deposit. Uses the same rules as the wallet cashier:
 * the code matches the address on screen, except Bitcoin (`bitcoin:`) and
 * Tron (`tron:`). An unknown rail stays the raw address — never a guessed chain.
 */
export function potDepositQrPayload(deposit: PotDepositSource): string {
  const address = deposit.depositAddress.trim()
  if (!address) throw new Error('Deposit response did not include an address.')
  const provided = deposit.qrPayload?.trim() ?? ''
  if (provided) return provided
  const combo = depositCombo(deposit.sourceAsset, deposit.sourceChain)
  if (!combo) return address
  return depositQrPayload(combo, address, undefined, nestSourceTokenMeta(deposit))
}

function depositCombo(
  sourceAsset: string | null | undefined,
  sourceChain: string | null | undefined,
): DepositCombo | null {
  const asset = sourceAsset?.trim().toLowerCase() ?? ''
  const chain = sourceChain?.trim().toLowerCase() ?? ''
  const normalizedAsset = asset === 'bitcoin' ? 'btc' : asset
  const normalizedChain =
    normalizedAsset === 'btc' && (chain === 'bitcoin' || chain === 'mainnet')
      ? 'mainnet'
      : chain
  return parseCashierCombo(normalizedAsset || null, normalizedChain || null)
}

/** Human view: labeled fields, the full address on its own line, then a QR. */
export async function formatDepositCard(
  card: DepositCard,
  mode: OutputMode,
): Promise<string> {
  const address = card.address.trim()
  if (!address) throw new Error('Deposit response did not include an address.')
  const qrPayload = potDepositQrPayload({
    depositAddress: address,
    sourceAsset: card.sourceAsset,
    sourceChain: card.sourceChain,
    sourceToken: card.sourceToken,
    qrPayload: card.qrPayload,
  })
  const ink = paint(mode)
  const lines = [
    heading(card.title, mode),
    ...card.fields
      .filter(([, value]) => value.trim() !== '')
      .map(([label, value]) => kv(label, value, mode)),
    '',
    ink.dim('address'),
    address,
  ]
  if (mode === 'pretty') {
    lines.push('', await renderTerminalQr(qrPayload))
  }
  return lines.join(NL)
}
