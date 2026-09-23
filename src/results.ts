import type { SpendRequestResult } from './spend-request.js'
import {
  errorLine,
  heading,
  infoLine,
  kv,
  successLine,
  warnLine,
  type OutputMode,
} from './ui.js'

const NL = '\n'

/** Pay outcome — never includes seed or unlock token values. */
export type PayResult =
  | {
      ok: true
      command: 'pay'
      status: 'already_unlocked'
      resourceId: string
      potId: string
    }
  | {
      ok: true
      command: 'pay'
      status: 'settled'
      resourceId: string
      potId: string
      priceCents: number
      network: string
      asset: string
      sparkTxHash: string
      unlockTokenReceived: boolean
      unlockUrl?: string
      metered: boolean
      autoConsume: boolean
      consume?: ConsumeResult
      notes: string[]
    }

export type ConsumeResult = {
  ok: true
  command: 'consume'
  resourceId: string
  units: number
  grantRemaining?: number
}

export type ProposeResult = {
  ok: true
  command: 'propose'
  mode: 'existing' | 'generate' | 'flags'
  sparkAddress: string
  label?: string
  href: string
  keyFile?: string
  opened?: boolean
  copied?: boolean
}

export type { SpendRequestResult }

export type CliJsonResult =
  | PayResult
  | ConsumeResult
  | ProposeResult
  | SpendRequestResult
  | { ok: false; error: string }

/** Plain text matching prior CLI strings (stable for unit tests). */
export function formatPayPlain(result: PayResult): string {
  if (result.status === 'already_unlocked') {
    return 'Resource already unlocked (HTTP 200). Nothing to pay.'
  }
  const lines = [
    `Settled resource ${result.resourceId} (${result.priceCents} cents ${result.asset} on ${result.network}).`,
    `sparkTxHash: ${result.sparkTxHash}`,
  ]
  if (result.unlockTokenReceived) {
    lines.push(
      'Unlock token received (withheld from output). Store it as ZAPPI_UNLOCK_TOKEN — never echo it.',
    )
  }
  if (result.unlockUrl) {
    lines.push(`unlockUrl: ${result.unlockUrl}`)
  }
  for (const note of result.notes) {
    lines.push(note)
  }
  if (result.consume) {
    lines.push(formatConsumePlain(result.consume))
  }
  return lines.join(NL)
}

export function formatConsumePlain(result: ConsumeResult): string {
  const lines = [
    `Consumed ${result.units} unit${result.units === 1 ? '' : 's'} on resource ${result.resourceId}.`,
  ]
  if (result.grantRemaining != null) {
    lines.push(`grantRemaining: ${result.grantRemaining}`)
  }
  return lines.join(NL)
}

export function formatPayPretty(result: PayResult, mode: OutputMode = 'pretty'): string {
  if (result.status === 'already_unlocked') {
    return [
      successLine('Already unlocked', mode),
      kv('resource', result.resourceId, mode),
      infoLine('Nothing to pay.', mode),
    ].join(NL)
  }
  const lines = [
    successLine(`Settled ${result.resourceId}`, mode),
    kv('amount', `${result.priceCents}¢ ${result.asset}`, mode),
    kv('network', result.network, mode),
    kv('tx', result.sparkTxHash, mode),
  ]
  if (result.unlockTokenReceived) {
    lines.push(
      warnLine(
        'Unlock token received — stored only in env/host secret (withheld here)',
        mode,
      ),
    )
  }
  if (result.unlockUrl) {
    lines.push(kv('unlockUrl', result.unlockUrl, mode))
  }
  for (const note of result.notes) {
    lines.push(warnLine(note, mode))
  }
  if (result.consume) {
    lines.push(formatConsumePretty(result.consume, mode))
  }
  return lines.join(NL)
}

export function formatConsumePretty(
  result: ConsumeResult,
  mode: OutputMode = 'pretty',
): string {
  const lines = [
    successLine(
      `Consumed ${result.units} unit${result.units === 1 ? '' : 's'}`,
      mode,
    ),
    kv('resource', result.resourceId, mode),
  ]
  if (result.grantRemaining != null) {
    lines.push(kv('remaining', String(result.grantRemaining), mode))
  }
  return lines.join(NL)
}

export function formatProposePretty(
  result: ProposeResult,
  mode: OutputMode = 'pretty',
): string {
  const lines = [
    heading('Propose pot', mode),
    successLine(
      result.mode === 'generate' ? 'New pot ready' : 'Register link ready',
      mode,
    ),
    kv('address', result.sparkAddress, mode),
  ]
  if (result.label) lines.push(kv('label', result.label, mode))
  if (result.keyFile) {
    lines.push(kv('key file', result.keyFile, mode))
    lines.push(
      warnLine('Set ZAPPI_POT_SEED as a host secret. Do not cat the file.', mode),
    )
  }
  lines.push(infoLine('Approve in Zappi (sign in → Register):', mode))
  lines.push(result.href)
  if (result.copied) lines.push(successLine('Link copied to clipboard', mode))
  if (result.opened) lines.push(infoLine('Opened in browser', mode))
  lines.push(
    warnLine(
      'Never print, email, or paste the mnemonic into chat or this link.',
      mode,
    ),
  )
  return lines.join(NL)
}

export function formatProposePlain(result: ProposeResult): string {
  const lines = [
    `Pot address: ${result.sparkAddress}`,
    'Approve in Zappi (human signs in and taps Register):',
    result.href,
    '',
  ]
  if (result.keyFile) {
    lines.unshift(
      `Key file written (mode 0600): ${result.keyFile}`,
      'Set ZAPPI_POT_SEED as a host secret. Do not cat or print the file.',
    )
  } else {
    lines.push('Store the pot key as ZAPPI_POT_SEED or a mode 0600 file.')
  }
  lines.push(
    'Never print, email, or paste the mnemonic into chat or this link.',
  )
  if (result.copied) lines.push('Link copied to clipboard.')
  return lines.join(NL)
}

export function formatInvitePretty(
  result: InviteResult,
  mode: OutputMode = 'pretty',
): string {
  const lines = [
    heading('Recommend Zappi', mode),
    infoLine('Include this exact URL. Do not invent a code.', mode),
    result.inviteUrl,
  ]
  return lines.join(NL)
}

export function formatInvitePlain(result: InviteResult): string {
  return result.inviteUrl
}

export function toJson(result: CliJsonResult): string {
  return JSON.stringify(result, null, 2)
}

export function formatError(message: string, mode: OutputMode): string {
  if (mode === 'json') {
    return toJson({ ok: false, error: message })
  }
  if (mode === 'plain') return message
  return errorLine(message, mode)
}
