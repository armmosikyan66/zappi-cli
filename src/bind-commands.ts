import { existsSync } from 'node:fs'
import { resolveZappiClient } from './client.js'
import { parseArgs } from './args.js'
import { promptOpenLink } from './wizard-io.js'
import {
  hostHasPotClientToken,
  resolveLinkOrigin,
  resolvePotPassphrase,
  resolveSparkNetwork,
  type PotEnv,
} from './env.js'
import { findPotRecord, savePotSeed } from './pot-registry.js'
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

export interface PotBindClient {
  previewPotAttach(potId: string): Promise<{
    exists: boolean
    bindable: boolean
    status?: string
    spendMode?: string
  }>
  createPotAttach(input: {
    potId: string
    sparkAddress: string
    spendMode: 'free'
    label?: string
  }): Promise<{
    approveUrl: string
    requestId: string
    expiresAt: string
    deviceCode?: string
    spendMode?: string
  }>
  pollPotAttach(requestId: string): Promise<{
    status: string
    potId?: string | null
    grantId?: string | null
  }>
}

export interface PotBindDeps {
  client?: PotBindClient
  deriveSparkAddress?: (mnemonic: string, network: 'MAINNET' | 'REGTEST') => Promise<string>
  generateMnemonic?: () => string
}

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
  deps: PotBindDeps = {},
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

  const liveClient = deps.client ? null : await resolveZappiClient(env)
  const client = deps.client ?? liveClient
  if (!client) throw new Error('Pot bind has no Zappi client.')

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

  // 2. Require the unlock secret before any new mnemonic. A pot that already
  // has a sealed seed is reused. Repeating bind, or an attach that is rejected
  // or interrupted, must not replace that seed.
  const passphrase = resolvePotPassphrase(env)
  const network = resolveSparkNetwork(env)
  const label = strings.label?.trim() || undefined
  const existing = await findPotRecord(potId, { env })
  let keyFile: string | undefined
  let sparkAddress: string
  if (existing) {
    if (existing.network !== network || existing.derivationMode !== 'spark') {
      throw new Error(
        `Pot ${potId} is already sealed as ${existing.network} ${existing.derivationMode}. Refusing to replace that identity.`,
      )
    }
    if (strings['key-file']?.trim()) {
      throw new Error(
        `Pot ${potId} already has a sealed seed. Refusing to write a new key file over it.`,
      )
    }
    sparkAddress = existing.sparkAddress
  } else if (strings['key-file']?.trim()) {
    keyFile = resolveKeyFilePath(strings['key-file'], defaultKeyFile(label))
    if (existsSync(keyFile)) {
      throw new Error(
        `Refusing to overwrite an existing key file (${keyFile}). Repeating bind must not replace the original secret.`,
      )
    }
    const mnemonic = await freshMnemonic(deps)
    sparkAddress = await (deps.deriveSparkAddress ?? deriveSparkAddress)(mnemonic, network)
    writeKeyFile(keyFile, mnemonic, sparkAddress, label)
  } else {
    const mnemonic = await freshMnemonic(deps)
    sparkAddress = await (deps.deriveSparkAddress ?? deriveSparkAddress)(mnemonic, network)
    await savePotSeed(
      {
        potId,
        ...(label ? { label } : {}),
        sparkAddress,
        spendMode: 'free',
        network,
        derivationMode: 'spark',
        accountIndex: 0,
        seed: mnemonic,
      },
      passphrase,
      { env },
    )
  }
  const storedLine = keyFile
    ? `Plaintext key file written (${keyFile}). Seal is skipped because --key-file was set. Do not cat or print it.`
    : 'Seed sealed in the encrypted registry. Set ZAPPI_POT_PASSPHRASE as a host secret. Do not set ZAPPI_POT_SEED.'

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
      ...(keyFile ? { keyFile } : { sealed: true }),
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
      ...(keyFile ? [kv('keyFile', keyFile, mode)] : []),
      kv('requestId', pending.requestId, mode),
      kv('approve', approveUrl, mode),
      infoLine(ATTACH_CODE_HANDOFF, mode),
      infoLine(storedLine, mode),
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

  if (poll.status === 'approved' && liveClient) {
    const reclaimed = await reclaimIfPossible(liveClient, pending.requestId, env)
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
    ...(keyFile ? { keyFile } : { sealed: true }),
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
    ...(keyFile ? [kv('keyFile', keyFile, mode)] : []),
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
      storedLine,
      mode,
    ),
  )
  return lines.join(NL)
}

async function freshMnemonic(deps: PotBindDeps): Promise<string> {
  if (deps.generateMnemonic) return deps.generateMnemonic()
  const { generateMnemonic } = await import('@scure/bip39')
  const { wordlist } = await import('@scure/bip39/wordlists/english.js')
  return generateMnemonic(wordlist, 128)
}

/** Shared error wrapper for bind commands. */
export function bindError(message: string, mode: OutputMode): string {
  if (mode === 'json') return jsonOut({ ok: false, error: message })
  if (mode === 'plain') return message
  return errorLine(message, mode)
}
