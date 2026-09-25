import { resolveZappiClient } from './client.js'
import { parseArgs } from './args.js'
import { promptOpenLink } from './wizard-io.js'
import {
  hostHasPotClientToken,
  POT_ALREADY_ATTACHED_ERROR,
  relocateAppLink,
  resolveLinkOrigin,
  type PotEnv,
} from './env.js'
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

/**
 * What the bot may say. The verification code is not in this string and is
 * not in the approve URL. The human pastes it on the Zappi page, not in chat.
 */
export const ATTACH_CODE_HANDOFF =
  'If the link does not open, paste the verification code on the Zappi pairing page. Do not paste that code into chat. Do not print or check the code.'

/** Public pot id on the pairing link. Full UUID, or a hex prefix of at least 8 characters. */
const POT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const POT_ID_PREFIX = /^[0-9a-f]{8,32}$/i

function publicPotId(value: string | undefined): string | null {
  const id = value?.trim() ?? ''
  if (POT_UUID.test(id) || POT_ID_PREFIX.test(id)) return id
  return null
}

function jsonOut(result: unknown): string {
  return JSON.stringify(result, null, 2)
}

/**
 * Link the bot pastes. Names the pot. Omits the user code — the page
 * loads that from the attach request. Never deviceCode or zpc_.
 */
export function botAttachApproveUrl(
  approveUrl: string,
  potId?: string | null,
  appOrigin?: string | null,
): string {
  let url: URL
  try {
    url = new URL(approveUrl)
  } catch {
    return approveUrl
  }
  url.searchParams.delete('code')
  const id = potId?.trim() ?? ''
  if (POT_UUID.test(id) || POT_ID_PREFIX.test(id)) {
    url.searchParams.set('pot', id)
  }
  if (appOrigin?.trim()) return relocateAppLink(url.toString(), appOrigin)
  return url.toString()
}

/** Public create fields only — never deviceCode, never userCode. */
function publicPending(pending: {
  requestId: string
  approveUrl: string
  expiresAt: string
  spendMode?: 'auth_required' | 'free' | null
  deviceCode?: string
}) {
  return {
    requestId: pending.requestId,
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
 * potClientToken via POST …/credentials + `X-Zappi-Device-Code` (1-203, Nest tip df7aafc).
 */
export async function runPotAttach(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { strings, booleans } = parseArgs(argv)
  if (hostHasPotClientToken(env)) {
    const result = {
      ok: true as const,
      command: 'pots attach' as const,
      alreadyAttached: true as const,
      message: POT_ALREADY_ATTACHED_ERROR,
    }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return POT_ALREADY_ATTACHED_ERROR
    return [
      heading('Pot already attached', mode),
      infoLine(POT_ALREADY_ATTACHED_ERROR, mode),
    ].join(NL)
  }
  const client = await resolveZappiClient(env)
  const spendMode = strings['spend-mode'] as 'auth_required' | 'free' | undefined
  const requestedPotId = publicPotId(env.ZAPPI_POT_ID)
  if (spendMode === 'auth_required' && !requestedPotId) {
    throw new Error(
      'Set ZAPPI_POT_ID before pots attach. The approve link must name that pot. Do not print a link without it.',
    )
  }
  const body: {
    sparkAddress?: string
    spendMode?: 'auth_required' | 'free'
    label?: string
    potId?: string
  } = {}
  if (strings['spark-address']) body.sparkAddress = strings['spark-address']
  if (spendMode) body.spendMode = spendMode
  if (strings.label) body.label = strings.label
  if (requestedPotId) body.potId = requestedPotId

  const pending = await client.createPotAttach(body)
  const approveUrl = botAttachApproveUrl(
    pending.approveUrl,
    requestedPotId,
    resolveLinkOrigin(env),
  )
  const printable = { ...pending, approveUrl }

  if (pending.deviceCode?.trim()) {
    writeAttachDeviceCode(pending.requestId, pending.deviceCode, env)
  }

  // Open the approve URL in the browser unless --no-poll / non-interactive.
  // The pasted link names the pot and does not include the user code.
  if (!booleans['no-poll'] && mode === 'pretty') {
    process.stdout.write(`${ATTACH_CODE_HANDOFF}${NL}`)
    await promptOpenLink(approveUrl, {
      headline: 'Approve this pot in Zappi:',
      openBrowser: true,
    }).catch(() => ({ action: 'skipped', auto: false }))
  }

  if (booleans['no-poll']) {
    const result = {
      ok: true as const,
      command: 'pots attach' as const,
      pending: publicPending(printable),
    }
    if (mode === 'json') {
      return jsonOut({ ...result, handoff: ATTACH_CODE_HANDOFF })
    }
    if (mode === 'plain') {
      return `requestId: ${pending.requestId} approve: ${approveUrl}${NL}${ATTACH_CODE_HANDOFF}`
    }
    return [
      heading('Pot attach pending', mode),
      kv('requestId', pending.requestId, mode),
      kv('approve', approveUrl, mode),
      infoLine(ATTACH_CODE_HANDOFF, mode),
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
