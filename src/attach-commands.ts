import { resolveZappiClient } from './client.js'
import { parseArgs } from './args.js'
import { promptOpenLink } from './wizard-io.js'
import { type PotEnv } from './env.js'
import {
  resolveAttachDeviceCode,
  writeAttachDeviceCode,
  writePotClientTokenFile,
} from './attach-device-secret.js'
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

/** Public create fields only — never deviceCode. */
function publicPending(pending: {
  requestId: string
  userCode: string
  approveUrl: string
  expiresAt: string
  spendMode?: 'auth_required' | 'free' | null
  deviceCode?: string
}) {
  return {
    requestId: pending.requestId,
    userCode: pending.userCode,
    approveUrl: pending.approveUrl,
    expiresAt: pending.expiresAt,
    ...(pending.spendMode !== undefined ? { spendMode: pending.spendMode } : {}),
    deviceCodeReceived: Boolean(pending.deviceCode?.trim()),
  }
}

async function reclaimIfPossible(
  client: Awaited<ReturnType<typeof resolveZappiClient>>,
  requestId: string,
  env: PotEnv,
): Promise<{
  potId?: string | null
  grantId?: string | null
  potClientTokenReceived: boolean
  potClientTokenPath: string | null
  status?: string
}> {
  const deviceCode = resolveAttachDeviceCode(requestId, env)
  if (!deviceCode) {
    return { potClientTokenReceived: false, potClientTokenPath: null }
  }
  const creds = await client.reclaimPotAttachCredentials(requestId, deviceCode)
  let potClientTokenPath: string | null = null
  let potClientTokenReceived = false
  if (creds.potClientToken?.trim()) {
    potClientTokenPath = writePotClientTokenFile(requestId, creds.potClientToken, env)
    potClientTokenReceived = true
  }
  return {
    potId: creds.potId,
    grantId: creds.grantId,
    potClientTokenReceived,
    potClientTokenPath,
    status: creds.status,
  }
}

/**
 * `zappi-cli pots attach [--spend-mode free|auth_required] [--spark-address <addr>] [--label L] [--no-poll]`
 *
 * Creates a pending attach (device-code P1), stores deviceCode as a host secret,
 * opens the approve URL for humans, polls public status, then reclaims
 * potClientToken with `X-Zappi-Device-Code` (1-203).
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

  if (pending.deviceCode?.trim()) {
    writeAttachDeviceCode(pending.requestId, pending.deviceCode, env)
  }

  // Open the approve URL in the browser unless --no-poll / non-interactive.
  // Never put deviceCode in the human URL (Nest contract).
  if (!booleans['no-poll'] && mode === 'pretty') {
    await promptOpenLink(pending.approveUrl, {
      headline: 'Approve this pot in Zappi:',
      openBrowser: true,
    }).catch(() => ({ action: 'skipped', auto: false }))
  }

  if (booleans['no-poll']) {
    const result = {
      ok: true as const,
      command: 'pots attach' as const,
      pending: publicPending(pending),
    }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return `requestId: ${pending.requestId} approve: ${pending.approveUrl}`
    return [
      heading('Pot attach pending', mode),
      kv('requestId', pending.requestId, mode),
      kv('userCode', pending.userCode, mode),
      kv('approve', pending.approveUrl, mode),
      ...(pending.deviceCode?.trim()
        ? [
            kv('deviceCode', '… (withheld; host secret)', mode),
            infoLine(
              'Device code stored under ~/.zappi/attach-device-<requestId>.txt (0600). Or set ZAPPI_ATTACH_DEVICE_CODE. Never echo it.',
              mode,
            ),
          ]
        : []),
      infoLine('Poll with: zappi-cli pots attach-status <requestId>', mode),
    ].join(NL)
  }

  // Poll public status until terminal (never expect potClientToken on poll).
  const deadline = Date.now() + 15 * 60 * 1000
  let poll = await client.pollPotAttach(pending.requestId)
  while (poll.status === 'pending' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    poll = await client.pollPotAttach(pending.requestId)
  }

  let potId = poll.potId ?? null
  let grantId = poll.grantId ?? null
  let potClientTokenReceived = false
  let potClientTokenPath: string | null = null

  if (poll.status === 'approved') {
    const reclaimed = await reclaimIfPossible(client, pending.requestId, env)
    if (reclaimed.potId) potId = reclaimed.potId
    if (reclaimed.grantId) grantId = reclaimed.grantId
    potClientTokenReceived = reclaimed.potClientTokenReceived
    potClientTokenPath = reclaimed.potClientTokenPath
  }

  const result = {
    ok: true as const,
    command: 'pots attach' as const,
    status: poll.status,
    requestId: pending.requestId,
    potId,
    grantId,
    deviceCodeReceived: Boolean(pending.deviceCode?.trim()),
    potClientTokenReceived,
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return `status: ${poll.status} potId: ${potId ?? '-'} grantId: ${grantId ?? '-'}`
  }
  const lines = [
    heading('Pot attach', mode),
    kv('requestId', pending.requestId, mode),
    successLine(`Status: ${poll.status}`, mode),
  ]
  if (potId) lines.push(kv('pot', potId, mode))
  if (grantId) lines.push(kv('grant', grantId, mode))
  if (potClientTokenReceived) {
    lines.push(kv('clientToken', 'zpc_… (withheld)', mode))
    lines.push(
      infoLine(
        potClientTokenPath
          ? `Stored pot client token as host secret (${potClientTokenPath}). Set ZAPPI_POT_CLIENT_TOKEN from that file. Do not echo it.`
          : 'Store the pot client token as ZAPPI_POT_CLIENT_TOKEN (host secret). Do not echo it.',
        mode,
      ),
    )
  } else if (poll.status === 'approved') {
    lines.push(
      infoLine(
        'Approved but pot client token not reclaimed. Set ZAPPI_ATTACH_DEVICE_CODE or keep ~/.zappi/attach-device-<requestId>.txt, then run attach-status.',
        mode,
      ),
    )
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

  let potId = poll.potId ?? null
  let grantId = poll.grantId ?? null
  let potClientTokenReceived = false
  let potClientTokenPath: string | null = null

  if (poll.status === 'approved') {
    const reclaimed = await reclaimIfPossible(client, requestId, env)
    if (reclaimed.potId) potId = reclaimed.potId
    if (reclaimed.grantId) grantId = reclaimed.grantId
    potClientTokenReceived = reclaimed.potClientTokenReceived
    potClientTokenPath = reclaimed.potClientTokenPath
  }

  const result = {
    ok: true as const,
    command: 'pots attach-status' as const,
    status: poll.status,
    requestId: poll.requestId,
    potId,
    grantId,
    potClientTokenReceived,
    deviceCodeAvailable: Boolean(resolveAttachDeviceCode(requestId, env)),
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return `status: ${poll.status} potId: ${potId ?? '-'} grantId: ${grantId ?? '-'}`
  }
  const lines = [
    heading('Pot attach status', mode),
    kv('requestId', poll.requestId, mode),
    kv('status', poll.status, mode),
    ...(potId ? [kv('pot', potId, mode)] : []),
    ...(grantId ? [kv('grant', grantId, mode)] : []),
  ]
  if (potClientTokenReceived) {
    lines.push(kv('clientToken', 'zpc_… (withheld)', mode))
    lines.push(
      infoLine(
        potClientTokenPath
          ? `Stored as host secret (${potClientTokenPath}). Set ZAPPI_POT_CLIENT_TOKEN. Do not echo it.`
          : 'Store as ZAPPI_POT_CLIENT_TOKEN (host secret). Do not echo it.',
        mode,
      ),
    )
  }
  return lines.join(NL)
}

/** Shared error wrapper for attach commands. */
export function attachError(message: string, mode: OutputMode): string {
  if (mode === 'json') return jsonOut({ ok: false, error: message })
  if (mode === 'plain') return message
  return errorLine(message, mode)
}
