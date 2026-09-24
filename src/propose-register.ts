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
import {
  hasAppOriginEnv,
  runProposeWizard,
  type WizardPresets,
} from './propose-wizard.js'
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
  /** True when `--origin` was passed. Env origin is tracked separately. */
  originExplicit: boolean
  generate: boolean
  open: boolean
  keyFile?: string
  /** free (default) | auth_required — sets deep-link mode tab */
  mode: PotSpendMode
  /** True when `--mode` was passed. The free default is not an explicit choice. */
  modeExplicit: boolean
  /** Invite code the caller already has. Propose does not mint one. */
  ref?: string
}

const USAGE = `Usage:
  zappi-cli propose                                  # interactive wizard — run on the agent host
  zappi-cli propose --address <pot-address> [--label Research] [--mode free|auth_required] [--origin <url>] [--ref CODE] [--open]
  zappi-cli propose --generate [--label Research] [--mode free|auth_required] [--origin <url>] [--ref CODE] [--key-file …] [--open]

On a terminal, bare propose asks before it generates or registers:
existing pot or generate new → how the pot should spend
→ Spark network (skipped when SPARK_NETWORK is set)
→ app origin (skipped when --origin, ZAPPI_APP_ORIGIN, or NEXT_PUBLIC_SITE_URL is set)
→ pot label (blank asks you to confirm auto pot_<unique> or type a custom name)
→ opens the Zappi register link.

Flags are for CI and non-interactive shells. When flags and env fully set the
pot source, spend mode, label, network, and origin, the CLI does not prompt.
A non-TTY bare propose prints this usage instead of hanging. Never prints the
pot key. Do not pass a recovery phrase as --address.`

export function parseProposeRegisterArgs(
  argv: string[],
  env: PotEnv = process.env,
): ProposeRegisterArgs {
  const parsed: ProposeRegisterArgs = {
    origin: resolveAppOrigin(env),
    originExplicit: false,
    generate: false,
    open: false,
    mode: 'free',
    modeExplicit: false,
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
      parsed.originExplicit = true
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
      parsed.modeExplicit = true
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

/**
 * Flags + env fully name the pot source, spend mode, label, network, and origin.
 * Anything missing on a TTY is asked. Non-TTY flag runs keep the previous defaults.
 */
export function isProposeFullySpecified(
  args: ProposeRegisterArgs,
  env: PotEnv,
): boolean {
  const hasPot = args.generate || Boolean(args.address?.trim())
  const hasLabel = Boolean(args.label?.trim())
  const hasNetwork = Boolean(env.SPARK_NETWORK?.trim())
  const hasOrigin = args.originExplicit || hasAppOriginEnv(env)
  return hasPot && args.modeExplicit && hasLabel && hasNetwork && hasOrigin
}

/** Map explicit flags onto wizard presets. Unset fields stay unset so the wizard asks. */
export function wizardPresetsFromArgs(
  args: ProposeRegisterArgs,
  _env: PotEnv,
): WizardPresets {
  const presets: WizardPresets = {}
  if (args.generate) presets.mode = 'generate'
  else if (args.address?.trim()) {
    presets.mode = 'existing'
    presets.sparkAddress = args.address.trim()
  }
  if (args.modeExplicit) presets.spendMode = args.mode
  if (args.label?.trim()) presets.label = args.label.trim()
  if (args.keyFile?.trim()) presets.keyFile = args.keyFile.trim()
  if (args.originExplicit) presets.origin = args.origin
  return presets
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

export interface ProposeRegisterDeps {
  /** Override TTY detection. Production uses `process.stdin.isTTY`. */
  isTTY?: boolean
  runWizard?: typeof runProposeWizard
}

async function executeFlagPropose(
  args: ProposeRegisterArgs,
  env: PotEnv,
): Promise<string> {
  const network = resolveSparkNetwork(env)
  let sparkAddress = args.address?.trim()

  if (args.generate) {
    const { generateMnemonic } = await import('@scure/bip39')
    const { wordlist } = await import('@scure/bip39/wordlists/english.js')
    const mnemonic = generateMnemonic(wordlist, 128)
    const generatedAddress = await deriveSparkAddress(mnemonic, network)
    const keyFile = resolveKeyFilePath(
      args.keyFile,
      defaultKeyFile(args.label),
    )
    writeKeyFile(keyFile, mnemonic, generatedAddress, args.label)
    const printed = printRegisterDeepLink({
      sparkAddress: generatedAddress,
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
        sparkAddress: generatedAddress,
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

export async function runProposeRegister(
  argv: string[],
  env: PotEnv = process.env,
  deps: ProposeRegisterDeps = {},
): Promise<string> {
  const tty = deps.isTTY ?? Boolean(process.stdin.isTTY)
  const wizard = deps.runWizard ?? runProposeWizard

  // Bare `propose` on a TTY walks every missing question before generate/register.
  // Non-TTY bare propose fails with usage so a pipe cannot hang.
  if (argv.length === 0) {
    if (!tty) {
      throw new Error(
        'Interactive wizard needs a terminal (TTY). Run from a shell, or use flags:\n\n' +
          USAGE,
      )
    }
    const result = await wizard(argv, env)
    return result.output
  }

  const args = parseProposeRegisterArgs(argv, env)
  // Incomplete flags on a TTY ask only for what is still unset.
  // Fully specified flags, and any non-TTY flag run, stay non-interactive.
  if (tty && !isProposeFullySpecified(args, env)) {
    const result = await wizard(argv, env, {}, wizardPresetsFromArgs(args, env))
    return result.output
  }

  return executeFlagPropose(args, env)
}
