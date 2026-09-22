import { resolveZappiClient } from './client.js'
import { parseArgs } from './args.js'
import type { CashierCombo } from '@zappimoney/zappi-sdk'
import { type PotEnv } from './env.js'
import {
  errorLine,
  heading,
  infoLine,
  kv,
  successLine,
  type OutputMode,
} from './ui.js'

const NL = '\n'

function jsonOut(result: unknown): string {
  return JSON.stringify(result, null, 2)
}

/** `zappi-cli deposit-options` */
export async function runDepositOptions(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  void argv
  const client = await resolveZappiClient(env)
  const options = await client.getDepositOptions()
  const result = { ok: true as const, command: 'deposit-options' as const, options }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    if (options.length === 0) return 'No deposit options.'
    return options
      .map((o) => `${o.asset}: ${o.networks.map((n) => n.id).join(',')}`)
      .join(NL)
  }
  if (options.length === 0) return infoLine('No deposit options.', mode)
  const lines = [heading('Deposit options', mode)]
  for (const o of options) {
    lines.push(successLine(o.asset, mode))
    for (const n of o.networks) {
      lines.push(`  ${kv('network', n.id, mode)} ${kv('arrival', n.estimatedArrivalCopy, mode)}`)
    }
  }
  return lines.join(NL)
}

/** `zappi-cli deposit-address --asset <a> --network <n>` */
export async function runDepositAddress(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { strings } = parseArgs(argv)
  const asset = strings.asset
  const network = strings.network
  if (!asset || !network) {
    throw new Error('Usage: zappi-cli deposit-address --asset <a> --network <n>')
  }
  const client = await resolveZappiClient(env)
  const dest = await client.getDepositDestination({ asset, network } as CashierCombo)
  const result = { ok: true as const, command: 'deposit-address' as const, ...dest }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return `asset: ${asset} network: ${network} address: ${JSON.stringify(dest)}`
  }
  return [
    heading('Deposit address', mode),
    kv('asset', asset, mode),
    kv('network', network, mode),
    kv('address', JSON.stringify(dest), mode),
  ].join(NL)
}

/** Shared error wrapper for deposit commands. */
export function depositError(message: string, mode: OutputMode): string {
  if (mode === 'json') return jsonOut({ ok: false, error: message })
  if (mode === 'plain') return message
  return errorLine(message, mode)
}
