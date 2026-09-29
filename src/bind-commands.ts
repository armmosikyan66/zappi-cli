import { resolveZappiClient } from './client.js'
import { parseArgs } from './args.js'
import { promptOpenLink } from './wizard-io.js'
import {
  hostHasPotClientToken,
  resolveLinkOrigin,
  resolveSparkNetwork,
  type PotEnv,
} from './env.js'
import {
  resolveAttachDeviceCode,
  writeAttachDeviceCode,
  writePotClientTokenFile,
} from './attach-device-secret.js'
import {
  defaultKeyFile,
  deriveSparkAddress,
  resolveKeyFilePath,
  writeKeyFile,
} from './pot-key-file.js'
import {
  ATTACH_CODE_HANDOFF,
  botAttachApproveUrl,
  reclaimIfPossible,
} from './attach-commands.js'
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

const POT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `zappi-cli pots bind <potId> [--label L] [--key-file <path>] [--no-poll]`
 *
 * Pot-first free pot: the app created an addressless `pending` free pot. This
 * host generates a BIP-39 key, saves it as a host secret, then pairs with the
 * named pot through the device-code attach flow. The user approves the pair
 * link; nest binds this host's sparkAddress onto the pot (pending -> active).
 * Never prints the mnemonic, the user code, or `zpc_`.
 */
export async function runPotBind(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals, strings, booleans } = parseArgs(argv)
  const potId = positionals[0]?.trim() ?? ''
  if (!potId || !POT_ID.test(potId)) {
    throw new Error(
      'Usage: zappi-cli pots bind <potId> [--label <name>] [--key-file <path>] [--no-poll]',
    )
  }
  if (hostHasPotClientToken(env)) {
    const result = {
      ok: true as const,
      command: 'pots bind' as const,
      alreadyAttached: true as const,
      message:
        'This host already holds a pot client token. Set ZAPPI_POT_ID and use the existing pot, or logout/remove ~/.zappi/pot-client-*.txt to pair a new one.',
    }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return result.message
    return [heading('Pot already attached', mode), infoLine(result.message, mode)].join(
      NL,
    )
  }

  const client = await resolveZappiClient(env)

  // 1. Confirm the pot exists, is free, and is pending (addressless) before
  //    generating a key. Public preview — no address or secrets returned.
  const preview = await client.previewPotAttach(potId)
  if (!preview.exists) {
    throw new Error(
      `Pot ${potId} was not found. Create the free pot in Zappi first, then run pots bind.`,
    )
  }
  if (!preview.bindable) {
    throw new Error(
      `Pot ${potId} is not bindable. It must be a free, addressless (pending) pot. Current status: ${preview.status ?? 'unknown'}, spendMode: ${preview.spendMode ?? 'unknown'}.`,
    )
  }

  // 2. Generate a BIP-39 mnemonic + derive the public spark address on this host.
  const network = resolveSparkNetwork(env)
  const { generateMnemonic } = await import('@scure/bip39')
  const { wordlist } = await import('@scure/bip39/wordlists/english.js')
  const mnemonic = generateMnemonic(wordlist, 128)
  const sparkAddress = await deriveSparkAddress(mnemonic, network)

  // 3. Write the 0600 key file. The mnemonic is a host secret — never print.
  const keyFile = resolveKeyFilePath(
    strings['key-file']?.trim() || undefined,
    defaultKeyFile(strings.label?.trim() || undefined),
  )
  writeKeyFile(keyFile, mnemonic, sparkAddress, strings.label?.trim() || undefined)

  // 4. Create the pending attach (device-code P1). The bot names the pot and
  //    provides the sparkAddress it generated. The user approves; nest binds.
  const pending = await client.createPotAttach({
    potId,
    sparkAddress,
    spendMode: 'free',
    ...(strings.label?.trim() ? { label: strings.label.trim() } : {}),
  })
  const approveUrl = botAttachApproveUrl(
    pending.approveUrl,
    potId,
    resolveLinkOrigin(env),
  )

  if (pending.deviceCode?.trim()) {
    writeAttachDeviceCode(pending.requestId, pending.deviceCode, env)
  }

  // 5. Print the pair URL only. Never the mnemonic, user code, or deviceCode.
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
      command: 'pots bind' as const,
      potId,
      sparkAddress,
      keyFile,
      pending: {
        requestId: pending.requestId,
        approveUrl,
        expiresAt: pending.expiresAt,
        spendMode: pending.spendMode ?? 'free',
      },
    }
    if (mode === 'json') {
      return jsonOut({ ...result, handoff: ATTACH_CODE_HANDOFF })
    }
    if (mode === 'plain') {
      return `potId: ${potId} address: ${sparkAddress} approve: ${approveUrl}${NL}${ATTACH_CODE_HANDOFF}`
    }
    return [
      heading('Pot bind pending', mode),
      kv('pot', potId, mode),
      kv('address', sparkAddress, mode),
      kv('keyFile', keyFile, mode),
      kv('requestId', pending.requestId, mode),
      kv('approve', approveUrl, mode),
      infoLine(ATTACH_CODE_HANDOFF, mode),
      infoLine(
        'Set ZAPPI_POT_ID and ZAPPI_POT_SEED (or ZAPPI_POT_KEY_FILE) as host secrets. Do not cat or print the key file.',
        mode,
      ),
      infoLine('Poll with: zappi-cli pots attach-status <requestId>', mode),
    ].join(NL)
  }

  // 6. Poll public status until terminal, then reclaim potClientToken.
  const deadline = Date.now() + 15 * 60 * 1000
  let poll = await client.pollPotAttach(pending.requestId)
  while (poll.status === 'pending' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    poll = await client.pollPotAttach(pending.requestId)
  }

  let resolvedPotId = poll.potId ?? potId
  let grantId = poll.grantId ?? null
  let potClientTokenReceived = false
  let potClientTokenPath: string | null = null

  if (poll.status === 'approved') {
    const reclaimed = await reclaimIfPossible(client, pending.requestId, env)
    if (reclaimed.potId) resolvedPotId = reclaimed.potId
    if (reclaimed.grantId) grantId = reclaimed.grantId
    potClientTokenReceived = reclaimed.potClientTokenReceived
    potClientTokenPath = reclaimed.potClientTokenPath
  }

  const result = {
    ok: true as const,
    command: 'pots bind' as const,
    status: poll.status,
    potId: resolvedPotId,
    grantId,
    sparkAddress,
    keyFile,
    deviceCodeReceived: Boolean(pending.deviceCode?.trim()),
    potClientTokenReceived,
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return `status: ${poll.status} potId: ${resolvedPotId} grantId: ${grantId ?? '-'}`
  }
  const lines = [
    heading('Pot bind', mode),
    kv('pot', resolvedPotId, mode),
    successLine(`Status: ${poll.status}`, mode),
    kv('address', sparkAddress, mode),
    kv('keyFile', keyFile, mode),
  ]
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
  lines.push(
    infoLine(
      `Set ZAPPI_POT_ID=${resolvedPotId} and ZAPPI_POT_SEED (or ZAPPI_POT_KEY_FILE=${keyFile}) as host secrets. Never print or paste the key.`,
      mode,
    ),
  )
  return lines.join(NL)
}

/** Shared error wrapper for bind commands. */
export function bindError(message: string, mode: OutputMode): string {
  if (mode === 'json') return jsonOut({ ok: false, error: message })
  if (mode === 'plain') return message
  return errorLine(message, mode)
}
