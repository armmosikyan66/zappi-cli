import { spawn } from 'node:child_process'
import {
  buildRegisterDeepLink,
  parseRegisterDeepLinkQuery,
  parsePotSpendMode,
  requireInviteRef,
  type PotSpendMode,
} from './register-deep-link.js'
import {
  defaultKeyFile,
  deriveSparkAddress,
  resolveKeyFilePath,
  writeKeyFile,
} from './pot-key-file.js'
import { runProposeWizard } from './propose-wizard.js'
import { resolveAppOrigin, resolveSparkNetwork, type PotEnv } from './env.js'

export {
  defaultKeyFile,
  deriveSparkAddress,
  resolveKeyFilePath,
  writeKeyFile,
} from './pot-key-file.js'
export { runProposeWizard } from './propose-wizard.js'

export interface ProposeRegisterArgs {
  address?: string
  label?: string
  origin: string
  generate: boolean
  open: boolean
  keyFile?: string
  /** free (default) | auth_required — sets deep-link mode tab */
  mode: PotSpendMode
  /** Invite code the caller already has. Propose does not mint one. */
  ref?: string
}

const USAGE = `Usage:
  zappi-cli propose                                  # interactive wizard — run on the agent host
  zappi-cli propose --address <pot-address> [--label Research] [--mode free|auth_required] [--ref CODE] [--open]
  zappi-cli propose --generate [--label Research] [--mode free|auth_required] [--ref CODE] [--key-file …] [--open]

The wizard asks: existing pot or generate new → how the pot should spend
→ pot label (blank = auto pot_<id>) → opens the Zappi register link in your browser
(ENTER to open, auto-opens after a few seconds, or "c" to copy it). Never prints
the pot key. Do not pass a recovery phrase as --address.`

export function parseProposeRegisterArgs(
  argv: string[],
  env: PotEnv = process.env,
): ProposeRegisterArgs {
  const parsed: ProposeRegisterArgs = {
    origin: resolveAppOrigin(env),
    generate: false,
    open: false,
    mode: 'free',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--address' && next) {
      parsed.address = next
      index += 1
    } else if (arg === '--label' && next) {
      parsed.label = next
      index += 1
    } else if (arg === '--origin' && next) {
      parsed.origin = next
      index += 1
    } else if (arg === '--key-file' && next) {
      parsed.keyFile = next
      index += 1
    } else if (arg === '--generate') {
      parsed.generate = true
    } else if (arg === '--open') {
      parsed.open = true
    } else if (arg === '--mode' && next) {
      const mode = parsePotSpendMode(next)
      if (!mode) {
        throw new Error('Use --mode free or --mode auth_required')
      }
      parsed.mode = mode
      index += 1
    } else if (arg === '--ref' && next && !next.startsWith('--')) {
      parsed.ref = requireInviteRef(next)
      index += 1
    } else if (arg === '--ref') {
      throw new Error(
        'Pass an invite code you already have as --ref. Propose does not invent one.',
      )
    } else if (arg === '--help' || arg === '-h') {
      throw new Error(USAGE)
    }
  }

  return parsed
}

export function printRegisterDeepLink(input: {
  sparkAddress: string
  label?: string
  origin?: string
  network?: 'MAINNET' | 'REGTEST'
  mode?: PotSpendMode
  ref?: string
}): string {
  const parsed = parseRegisterDeepLinkQuery(
    {
      register: input.sparkAddress,
      label: input.label,
    },
    input.network ?? 'MAINNET',
  )
  if (parsed.status === 'mnemonic') {
    throw new Error(
      'Do not pass a recovery phrase. Pass the public pot address only.',
    )
  }
  if (parsed.status !== 'ok') {
    throw new Error(
      'Pass a public pot address as --address (checksum matching this network).',
    )
  }

  const inviteRef = input.ref ? requireInviteRef(input.ref) : undefined
  const href = buildRegisterDeepLink({
    sparkAddress: parsed.sparkAddress,
    label: parsed.label,
    origin: input.origin,
    network: input.network,
    mode: input.mode ?? 'free',
    ref: inviteRef,
  })
  if (!href) {
    throw new Error('Could not build the register deep link.')
  }

  return [
    `Pot address: ${parsed.sparkAddress}`,
    'Approve in Zappi (human signs in and taps Register):',
    href,
    '',
    'Store the pot key as ZAPPI_POT_SEED or a mode 0600 file.',
    'Never print, email, or paste the pot key into chat or this link.',
  ].join('\n')
}

function openUrl(href: string) {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [href], { stdio: 'ignore', detached: true })
  child.unref()
}

export async function runProposeRegister(
  argv: string[],
  env: PotEnv = process.env,
): Promise<string> {
  // Bare `zappi-cli propose` on a TTY → interactive wizard:
  // existing vs new pot → label (blank = pot_<unique>) → auth/browser prompt.
  if (argv.length === 0) {
    if (process.stdin.isTTY) {
      const result = await runProposeWizard(argv, env)
      return result.output
    }
    throw new Error(
      'Interactive wizard needs a terminal (TTY). Run from a shell, or use flags:\n\n' +
        USAGE,
    )
  }

  const args = parseProposeRegisterArgs(argv, env)
  const network = resolveSparkNetwork(env)
  let sparkAddress = args.address?.trim()

  if (args.generate) {
    const { generateMnemonic } = await import('@scure/bip39')
    const { wordlist } = await import('@scure/bip39/wordlists/english.js')
    const mnemonic = generateMnemonic(wordlist, 128)
    sparkAddress = await deriveSparkAddress(mnemonic, network)
    const keyFile = resolveKeyFilePath(
      args.keyFile,
      defaultKeyFile(args.label),
    )
    writeKeyFile(keyFile, mnemonic, sparkAddress, args.label)
    const printed = printRegisterDeepLink({
      sparkAddress,
      label: args.label,
      origin: args.origin,
      network,
      mode: args.mode,
      ref: args.ref,
    })
    const output = [
      printed,
      `Key file written (mode 0600): ${keyFile}`,
      'Set ZAPPI_POT_SEED as a host secret. Do not cat or print the file.',
    ].join('\n')
    if (args.open) {
      const href = buildRegisterDeepLink({
        sparkAddress,
        label: args.label,
        origin: args.origin,
        network,
        mode: args.mode,
        ref: args.ref,
      })
      if (href) openUrl(href)
    }
    return output
  }

  const printed = printRegisterDeepLink({
    sparkAddress: sparkAddress ?? '',
    label: args.label,
    origin: args.origin,
    network,
    mode: args.mode,
    ref: args.ref,
  })
  if (args.open) {
    const href = buildRegisterDeepLink({
      sparkAddress: sparkAddress ?? '',
      label: args.label,
      origin: args.origin,
      network,
      mode: args.mode,
      ref: args.ref,
    })
    if (href) openUrl(href)
  }
  return printed
}
