import { resolveZappiClient } from './client.js'
import { parseArgs } from './args.js'
import { promptOpenLink } from './wizard-io.js'
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

/**
 * `zappi-cli pots attach [--spend-mode free|auth_required] [--spark-address <addr>] [--label L] [--no-poll]`
 *
 * Creates a pending attach (device-code P1), opens the approve URL in the
 * browser, and polls until the user approves (or the request expires).
 */
export async function runPotAttach(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { strings, booleans } = parseArgs(argv)
  const client = await resolveZappiClient(env)
  const body: { sparkAddress?: string; spendMode?: 'auth_required' | 'free'; label?: string } = {}
  if (strings['spark-address']) body.sparkAddress = strings['spark-address']
  if (strings['spend-mode']) body.spendMode = strings['spend-mode'] as 'auth_required' | 'free'
  if (strings.label) body.label = strings.label

  const pending = await client.createPotAttach(body)

  // Open the approve URL in the browser unless --no-poll / non-interactive.
  if (!booleans['no-poll'] && mode === 'pretty') {
    await promptOpenLink(pending.approveUrl, {
      headline: 'Approve this pot in Zappi:',
      openBrowser: true,
    }).catch(() => ({ action: 'skipped', auto: false }))
  }

  if (booleans['no-poll']) {
    const result = { ok: true as const, command: 'pots attach' as const, pending }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return `requestId: ${pending.requestId} approve: ${pending.approveUrl}`
    return [
      heading('Pot attach pending', mode),
      kv('requestId', pending.requestId, mode),
      kv('userCode', pending.userCode, mode),
      kv('approve', pending.approveUrl, mode),
      infoLine('Poll with: zappi-cli pots attach-status <requestId>', mode),
    ].join(NL)
  }

  // Poll until terminal.
  const deadline = Date.now() + 15 * 60 * 1000
  let poll = await client.pollPotAttach(pending.requestId)
  while (
    poll.status === 'pending' &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    poll = await client.pollPotAttach(pending.requestId)
  }

  const result = {
    ok: true as const,
    command: 'pots attach' as const,
    status: poll.status,
    requestId: pending.requestId,
    potId: poll.potId ?? null,
    grantId: poll.grantId ?? null,
    potClientToken: poll.potClientToken ?? null,
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return `status: ${poll.status} potId: ${poll.potId ?? '-'} grantId: ${poll.grantId ?? '-'}`
  }
  const lines = [
    heading('Pot attach', mode),
    kv('requestId', pending.requestId, mode),
    successLine(`Status: ${poll.status}`, mode),
  ]
  if (poll.potId) lines.push(kv('pot', poll.potId, mode))
  if (poll.grantId) lines.push(kv('grant', poll.grantId, mode))
  if (poll.potClientToken) {
    lines.push(kv('clientToken', 'zpc_… (withheld)', mode))
    lines.push(infoLine('Store the pot client token as a host secret. Do not echo it.', mode))
  }
  return lines.join(NL)
}

/** `zappi-cli pots attach-status <requestId>` */
export async function runPotAttachStatus(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals } = parseArgs(argv)
  const requestId = positionals[0]
  if (!requestId) throw new Error('Usage: zappi-cli pots attach-status <requestId>')
  const client = await resolveZappiClient(env)
  const poll = await client.pollPotAttach(requestId)
  const result = { ok: true as const, command: 'pots attach-status' as const, ...poll }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return `status: ${poll.status} potId: ${poll.potId ?? '-'} grantId: ${poll.grantId ?? '-'}`
  }
  return [
    heading('Pot attach status', mode),
    kv('requestId', poll.requestId, mode),
    kv('status', poll.status, mode),
    ...(poll.potId ? [kv('pot', poll.potId, mode)] : []),
    ...(poll.grantId ? [kv('grant', poll.grantId, mode)] : []),
  ].join(NL)
}

/** Shared error wrapper for attach commands. */
export function attachError(message: string, mode: OutputMode): string {
  if (mode === 'json') return jsonOut({ ok: false, error: message })
  if (mode === 'plain') return message
  return errorLine(message, mode)
}
