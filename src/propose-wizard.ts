import {
  buildRegisterDeepLink,
  inviteRefFromArgv,
  parseRegisterDeepLinkQuery,
  parsePotSpendMode,
  type PotSpendMode,
} from './register-deep-link.js'
import {
  defaultKeyFile,
  deriveSparkAddress,
  resolveKeyFilePath,
  writeKeyFile,
} from './pot-key-file.js'
import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import {
  LOCAL_ZAPPI_APP_ORIGIN,
  PRODUCTION_ZAPPI_APP_ORIGIN,
  STAGING_ZAPPI_APP_ORIGIN,
  resolveAppOrigin,
  resolveSparkNetwork,
} from './env.js'
import {
  ask,
  select,
  generatePotLabel,
  promptOpenLink,
  type SelectOption,
} from './wizard-io.js'
import { infoLine, kv, successLine } from './ui.js'

export const WIZARD_MODES = ['existing', 'generate'] as const
export type WizardMode = (typeof WIZARD_MODES)[number]

/** Generate is the default (first) row — most `zappi-cli propose` runs create a fresh pot. */
export const WIZARD_MODE_OPTIONS: SelectOption[] = [
  { label: 'Generate a new pot (create a fresh key on this host)', value: 'generate' },
  { label: 'Use an existing pot (I already registered one)', value: 'existing' },
]

/** Matches web pots chooser: Auth not required vs Auth required. */
export const AUTH_MODE_OPTIONS: SelectOption[] = [
  {
    label: 'Auth not required — the agent can spend without asking you',
    value: 'free',
  },
  {
    label: 'Auth required — approve each payment in Zappi',
    value: 'auth_required',
  },
]

const AUTH_MODE_PROMPT = 'How should this pot spend?'

/** Asked only when `SPARK_NETWORK` is unset. REGTEST is first because the default API is staging. */
export const NETWORK_PROMPT =
  'Which Spark network matches the Zappi app you will register in?'

export const NETWORK_OPTIONS: SelectOption[] = [
  { label: 'REGTEST', value: 'REGTEST' },
  { label: 'MAINNET', value: 'MAINNET' },
]

/** Local web. Chosen only when the human picks it or sets `ZAPPI_APP_ORIGIN`. */
export const LOCAL_APP_ORIGIN = LOCAL_ZAPPI_APP_ORIGIN

/** Asked only when app-origin env is unset and `--origin` was not passed. */
export const ORIGIN_PROMPT = 'Which Zappi app should the register link open?'

export const ORIGIN_CUSTOM_VALUE = 'custom'

export const ORIGIN_OPTIONS: SelectOption[] = [
  {
    label: 'Staging — https://dev.zappi.money (pair with api-dev)',
    value: STAGING_ZAPPI_APP_ORIGIN,
  },
  { label: 'Production — https://zappi.money', value: PRODUCTION_ZAPPI_APP_ORIGIN },
  { label: 'Local — http://localhost:3000', value: LOCAL_APP_ORIGIN },
  { label: 'Custom URL', value: ORIGIN_CUSTOM_VALUE },
]

/** Shown after a blank label. Auto is the first row so ENTER accepts `pot_<unique>`. */
export const LABEL_CONFIRM_PROMPT =
  'That name is blank. Auto-name this pot, or enter a custom name?'

export const LABEL_CONFIRM_OPTIONS: SelectOption[] = [
  { label: 'Auto-name (pot_<unique>)', value: 'auto' },
  { label: 'Enter a custom name', value: 'custom' },
]

const REGISTER_HEADLINE = 'Register this pot in Zappi:'

/** Success summary for free (auth not required). */
function formatFreeSuccess(input: {
  sparkAddress: string
  label: string
  href: string
  network: 'MAINNET' | 'REGTEST'
  origin: string
  keyFile?: string
  openResult?: { action: string; auto: boolean }
}): string {
  const lines = [
    successLine('Pot created successfully (auth not required)'),
    kv('address', input.sparkAddress),
    kv('label', input.label),
    kv('network', input.network),
    kv('app', input.origin),
  ]
  if (input.keyFile) {
    lines.push(kv('key file', input.keyFile))
    lines.push(infoLine('Set ZAPPI_POT_SEED as a host secret. Do not cat the file.'))
  } else {
    lines.push(infoLine('Store the pot key as ZAPPI_POT_SEED or a mode 0600 file.'))
  }
  lines.push(kv('register', input.href))
  if (input.openResult?.action === 'copied') {
    lines.push(infoLine('Link copied to clipboard.'))
  } else if (input.openResult?.action === 'skipped') {
    lines.push(infoLine('Could not open the browser — open the register link in Zappi now.'))
  } else {
    lines.push(infoLine('Sign in to Zappi and tap Register.'))
  }
  lines.push(
    infoLine(
      'Disconnect cannot stop on-chain spend. Empty pot is the cap.',
    ),
  )
  lines.push(infoLine('Never print, email, or paste the pot key into chat or this link.'))
  return lines.join('\n')
}


export interface WizardDeps {
  env: PotEnvSubset
  ask: (prompt: string) => Promise<string>
  select: (prompt: string, options: SelectOption[]) => Promise<string>
  generateMnemonic: () => string
  deriveAddress: (mnemonic: string, network: 'MAINNET' | 'REGTEST') => Promise<string>
  writeKeyFile: (path: string, mnemonic: string, sparkAddress: string, label?: string) => void
  defaultKeyFile: (label?: string) => string
  promptOpenLink: (href: string, options?: { autoOpenMs?: number; headline?: string; openBrowser?: boolean }) => Promise<{ action: string; auto: boolean }>
}

export interface PotEnvSubset {
  ZAPPI_APP_ORIGIN?: string
  NEXT_PUBLIC_SITE_URL?: string
  SPARK_NETWORK?: string
}

export interface RunProposeWizardResult {
  mode: WizardMode
  spendMode: PotSpendMode
  label: string
  network: 'MAINNET' | 'REGTEST'
  origin: string
  sparkAddress?: string
  keyFile?: string
  href?: string
  openResult?: { action: string; auto: boolean }
  output: string
}

/** Settings already chosen via flags. Omitted fields are asked on a TTY. */
export interface WizardPresets {
  mode?: WizardMode
  spendMode?: PotSpendMode
  label?: string
  sparkAddress?: string
  keyFile?: string
  origin?: string
}

const MODE_PROMPT = `Do you already have a pot, or should this host generate a new one?`

const LABEL_HINT = '(blank = confirm auto-name pot_<unique>)'

export function hasSparkNetworkEnv(env: PotEnvSubset): boolean {
  return Boolean(env.SPARK_NETWORK?.trim())
}

export function hasAppOriginEnv(env: PotEnvSubset): boolean {
  return Boolean(env.ZAPPI_APP_ORIGIN?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim())
}

/** http(s) origin, or null. Does not invent a production fallback. */
export function parseHttpOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

const ORIGIN_GUIDANCE =
  'Choose a Zappi app origin: staging (https://dev.zappi.money), production (https://zappi.money), local (http://localhost:3000), or a custom http(s) URL.'

async function resolveWizardNetwork(
  env: PotEnvSubset,
  selectFn: WizardDeps['select'],
): Promise<'MAINNET' | 'REGTEST'> {
  if (hasSparkNetworkEnv(env)) return resolveSparkNetwork(env)
  const choice = (await selectFn(NETWORK_PROMPT, NETWORK_OPTIONS)).trim().toUpperCase()
  if (choice === 'MAINNET' || choice === 'REGTEST') return choice
  throw new Error(
    'Choose MAINNET or REGTEST. The network must match the Zappi app you will register in.',
  )
}

async function askCustomOrigin(askFn: WizardDeps['ask']): Promise<string> {
  for (;;) {
    const answer = (await askFn('Custom app origin (http:// or https://):')).trim()
    if (!answer) {
      throw new Error(`Cancelled — no app origin. ${ORIGIN_GUIDANCE}`)
    }
    const origin = parseHttpOrigin(answer)
    if (origin) return origin
    process.stdout.write('Enter an http(s) origin, for example https://zappi.money.\n')
  }
}

async function resolveWizardOrigin(
  env: PotEnvSubset,
  askFn: WizardDeps['ask'],
  selectFn: WizardDeps['select'],
  presetOrigin?: string,
): Promise<string> {
  if (presetOrigin?.trim()) {
    const parsed = parseHttpOrigin(presetOrigin)
    if (!parsed) {
      throw new Error(`App origin must be an http(s) URL. ${ORIGIN_GUIDANCE}`)
    }
    return parsed
  }
  if (hasAppOriginEnv(env)) return resolveAppOrigin(env)
  const choice = (await selectFn(ORIGIN_PROMPT, ORIGIN_OPTIONS)).trim()
  if (choice === ORIGIN_CUSTOM_VALUE) return askCustomOrigin(askFn)
  const parsed = parseHttpOrigin(choice)
  if (parsed) return parsed
  throw new Error(ORIGIN_GUIDANCE)
}

/**
 * A typed name is used as-is. A blank answer asks to confirm auto `pot_<unique>`
 * or a custom name. Choosing auto, or leaving the custom name blank, accepts auto.
 */
export async function resolveWizardLabel(
  askFn: WizardDeps['ask'],
  selectFn: WizardDeps['select'],
  prompt: string,
): Promise<string> {
  const typed = (await askFn(prompt)).trim()
  if (typed) return typed
  const choice = (await selectFn(LABEL_CONFIRM_PROMPT, LABEL_CONFIRM_OPTIONS)).trim()
  if (choice === 'custom') {
    const custom = await askFn('Custom pot name (blank accepts auto pot_<unique>):')
    return generatePotLabel(custom)
  }
  if (choice === 'auto') return generatePotLabel('')
  throw new Error(
    'Choose auto-name (pot_<unique>) or enter a custom pot name. A blank custom name accepts the auto name.',
  )
}

export async function runProposeWizard(
  argv: string[] = [],
  env: PotEnvSubset = process.env,
  deps: Partial<WizardDeps> = {},
  presets: WizardPresets = {},
): Promise<RunProposeWizardResult> {
  const d: WizardDeps = {
    env,
    ask: deps.ask ?? ask,
    select: deps.select ?? select,
    generateMnemonic: deps.generateMnemonic ?? (() => generateMnemonic(wordlist, 128)),
    deriveAddress: deps.deriveAddress ?? deriveSparkAddress,
    writeKeyFile: deps.writeKeyFile ?? writeKeyFile,
    defaultKeyFile: deps.defaultKeyFile ?? defaultKeyFile,
    promptOpenLink: deps.promptOpenLink ?? promptOpenLink,
  }

  const inviteRef = inviteRefFromArgv(argv)

  // Step 1 — existing or new? (arrow-key menu, generate first = default)
  const rawMode =
    presets.mode ??
    (WIZARD_MODES.includes(argv[0] as WizardMode)
      ? (argv[0] as WizardMode)
      : await d.select(MODE_PROMPT, WIZARD_MODE_OPTIONS))
  if (rawMode !== 'existing' && rawMode !== 'generate') {
    throw new Error('Choose an existing pot or generate a new one on this host.')
  }
  const mode: WizardMode = rawMode

  // Step 2 — auth tab: free (no auth) vs auth_required
  const rawSpend = presets.spendMode ?? (await d.select(AUTH_MODE_PROMPT, AUTH_MODE_OPTIONS))
  const spendMode = parsePotSpendMode(rawSpend)
  if (!spendMode) {
    throw new Error(
      'Choose how this pot should spend: free (auth not required) or auth_required.',
    )
  }

  // Step 3 — network, then app origin. Both happen before generate/register.
  const network = await resolveWizardNetwork(env, d.select)
  const origin = await resolveWizardOrigin(env, d.ask, d.select, presets.origin)

  if (mode === 'existing') {
    // Step 4 — address (validated, re-ask until valid, blank exits).
    let sparkAddress = ''
    const presetAddress = presets.sparkAddress?.trim()
    if (presetAddress) {
      const parsed = parseRegisterDeepLinkQuery(
        { register: presetAddress, label: undefined },
        network,
      )
      if (parsed.status === 'mnemonic') {
        throw new Error(
          'Do not pass a recovery phrase. Pass the public pot address only.',
        )
      }
      if (parsed.status !== 'ok') {
        throw new Error(
          `That address is not valid for ${network}. Pass the public pot address, or pick the matching network.`,
        )
      }
      sparkAddress = parsed.sparkAddress
    } else {
      for (;;) {
        const answer = await d.ask(
          'Public pot address from your agent [blank = cancel]:',
        )
        const trimmed = answer.trim()
        if (!trimmed) {
          throw new Error('Cancelled — no address provided.')
        }
        const parsed = parseRegisterDeepLinkQuery(
          { register: trimmed, label: undefined },
          network,
        )
        if (parsed.status === 'ok') {
          sparkAddress = parsed.sparkAddress
          break
        }
        if (parsed.status === 'mnemonic') {
          process.stdout.write(
            'That looks like a recovery phrase — never paste it here. Pass the public pot address only.\n',
          )
          continue
        }
        process.stdout.write(
          `That address is not valid for ${network}. Use the public pot address from your agent.\n`,
        )
      }
    }

    // Step 5 — label. Blank asks to confirm auto pot_<unique> vs a custom name.
    const label = presets.label?.trim()
      ? presets.label.trim()
      : await resolveWizardLabel(
          d.ask,
          d.select,
          `Label for this pot ${LABEL_HINT}:`,
        )

    const href = buildRegisterDeepLink({
      sparkAddress,
      label,
      origin,
      network,
      mode: spendMode,
      ref: inviteRef,
    })
    if (!href) throw new Error('Could not build the register deep link.')

    const openResult = await d.promptOpenLink(href, {
      headline: spendMode === 'free' ? REGISTER_HEADLINE : 'Approve / authenticate this pot at:',
      openBrowser: true,
    })
    if (spendMode === 'free') {
      const output = formatFreeSuccess({
        sparkAddress,
        label,
        href,
        network,
        origin,
        openResult,
      })
      return {
        mode,
        spendMode,
        label,
        network,
        origin,
        sparkAddress,
        href,
        openResult,
        output,
      }
    }

    const lines: string[] = []
    if (openResult.action === 'copied') {
      lines.push('Link copied to clipboard.')
    } else if (openResult.action === 'skipped') {
      lines.push('Could not copy — open the link above manually.')
    }
    lines.push(
      `Pot address: ${sparkAddress}`,
      'Spend mode: auth required',
      `Network: ${network}`,
      `App: ${origin}`,
      'Approve in Zappi (sign in / authenticate):',
      href,
      '',
      'The key is created in Zappi on your device when you approve. This host does not store it.',
    )
    return {
      mode,
      spendMode,
      label,
      network,
      origin,
      sparkAddress,
      href,
      openResult,
      output: lines.join('\n'),
    }
  }

  if (spendMode === 'auth_required') {
    throw new Error(
      'Approval-required pots do not get a key on this host. Create the pot in Zappi, then run `zappi-cli pots attach --spend-mode auth_required`. Do not generate or store a pot key.',
    )
  }

  // generate mode ---------------------------------------------------------
  // Label first (feeds the key-file name). Blank confirms auto pot_<unique>.
  const label = presets.label?.trim()
    ? presets.label.trim()
    : await resolveWizardLabel(
        d.ask,
        d.select,
        `Name your new pot ${LABEL_HINT}:`,
      )

  // Key file confirmation. A directory (or trailing slash) writes
  // the suggested filename inside it so we never EISDIR after generating.
  const suggested = d.defaultKeyFile(label)
  const keyFile = presets.keyFile?.trim()
    ? resolveKeyFilePath(presets.keyFile, suggested)
    : resolveKeyFilePath(
        await d.ask(`Pot key file [${suggested}]:`),
        suggested,
      )

  process.stdout.write('Generating pot key…\n')
  const mnemonic = d.generateMnemonic()
  const sparkAddress = await d.deriveAddress(mnemonic, network)
  d.writeKeyFile(keyFile, mnemonic, sparkAddress, label)

  const href = buildRegisterDeepLink({
    sparkAddress,
    label,
    origin,
    network,
    mode: spendMode,
    ref: inviteRef,
  })
  if (!href) throw new Error('Could not build the deep link for the new pot.')

  const openResult = await d.promptOpenLink(href, {
    headline: spendMode === 'free' ? REGISTER_HEADLINE : 'Approve / authenticate this pot at:',
    openBrowser: true,
  })
  const output = formatFreeSuccess({
    sparkAddress,
    label,
    href,
    network,
    origin,
    keyFile,
    openResult,
  })
  return {
    mode,
    spendMode,
    label,
    network,
    origin,
    sparkAddress,
    keyFile,
    href,
    openResult,
    output,
  }
}
