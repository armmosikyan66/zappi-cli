import {
  buildRegisterDeepLink,
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
import { resolveAppOrigin, resolveSparkNetwork } from './env.js'
import {
  ask,
  select,
  generatePotLabel,
  promptOpenLink,
  type SelectOption,
} from './wizard-io.js'

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
    label: 'Auth not required — agent can spend without approval (free)',
    value: 'free',
  },
  {
    label: 'Auth required — approve each payment in Zappi',
    value: 'auth_required',
  },
]

const AUTH_MODE_PROMPT = 'How should this pot spend when you test it?'

export interface WizardDeps {
  env: PotEnvSubset
  ask: (prompt: string) => Promise<string>
  select: (prompt: string, options: SelectOption[]) => Promise<string>
  generateMnemonic: () => string
  deriveAddress: (mnemonic: string, network: 'MAINNET' | 'REGTEST') => Promise<string>
  writeKeyFile: (path: string, mnemonic: string, sparkAddress: string, label?: string) => void
  defaultKeyFile: (label?: string) => string
  promptOpenLink: (href: string, options?: { autoOpenMs?: number }) => Promise<{ action: string; auto: boolean }>
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
  sparkAddress?: string
  keyFile?: string
  href?: string
  openResult?: { action: string; auto: boolean }
  output: string
}

const MODE_PROMPT = `Do you already have a pot, or should this host generate a new one?`

const LABEL_HINT = '(blank = auto-name like pot_a1b2c3d4)'

export async function runProposeWizard(
  argv: string[] = [],
  env: PotEnvSubset = process.env,
  deps: Partial<WizardDeps> = {},
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

  const network = resolveSparkNetwork(env)
  const origin = resolveAppOrigin(env)

  // Step 1 — existing or new? (arrow-key menu, generate first = default)
  const rawMode = WIZARD_MODES.includes(argv[0] as WizardMode)
    ? argv[0]
    : await d.select(MODE_PROMPT, WIZARD_MODE_OPTIONS)
  const mode: WizardMode =
    rawMode === 'existing' || rawMode === 'generate' ? rawMode : 'existing'

  // Step 1b — auth tab: free (no auth) vs auth_required
  const rawSpend = await d.select(AUTH_MODE_PROMPT, AUTH_MODE_OPTIONS)
  const spendMode: PotSpendMode = parsePotSpendMode(rawSpend) ?? 'free'

  const lines: string[] = []

  if (mode === 'existing') {
    // Step 2 — address (validated, re-ask until valid, blank exits).
    let sparkAddress = ''
    for (;;) {
      const answer = await d.ask(
        'Existing pot public address (spark1… or sparkrt1…) [blank = cancel]:',
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
          'That looks like a recovery phrase — never paste it here. Pass the public spark1 address only.\n',
        )
        continue
      }
      process.stdout.write(
        'Invalid address for this network — expected a Bech32m spark address with a valid checksum.\n',
      )
    }

    // Step 3 — label (blank = pot_<unique>).
    const label = generatePotLabel(await d.ask(`Label for this pot ${LABEL_HINT}:`))

    const href = buildRegisterDeepLink({ sparkAddress, label, origin, network, mode: spendMode })
    if (!href) throw new Error('Could not build the register deep link.')

    // Step 4 — auth: open browser (ENTER / timeout auto-open / copy).
    const openResult = await d.promptOpenLink(href)
    if (openResult.action === 'copied') {
      lines.push('Link copied to clipboard.')
    } else if (openResult.action === 'skipped') {
      lines.push('Could not copy — open the link above manually.')
    }
    lines.push(
      `Pot address: ${sparkAddress}`,
      `Spend mode: ${spendMode === 'free' ? 'auth not required (free)' : 'auth required'}`,
      `Approve in Zappi (human signs in and taps Register):`,
      href,
      '',
      'Store the pot key as ZAPPI_POT_SEED or a mode 0600 file.',
      'Never print, email, or paste the mnemonic into chat or this link.',
    )
    return { mode, spendMode, label, sparkAddress, href, openResult, output: lines.join('\n') }
  }

  // generate mode ---------------------------------------------------------
  // Step 2 — label first (feeds the key-file name), blank = pot_<unique>.
  const label = generatePotLabel(await d.ask(`Name your new pot ${LABEL_HINT}:`))

  // Step 3 — key file confirmation. A directory (or trailing slash) writes
  // the suggested filename inside it so we never EISDIR after generating.
  const suggested = d.defaultKeyFile(label)
  const keyFileAnswer = await d.ask(
    `Key file for the pot mnemonic [${suggested}]:`,
  )
  const keyFile = resolveKeyFilePath(keyFileAnswer, suggested)

  process.stdout.write('Generating pot key…\n')
  const mnemonic = d.generateMnemonic()
  const sparkAddress = await d.deriveAddress(mnemonic, network)
  d.writeKeyFile(keyFile, mnemonic, sparkAddress, label)

  const href = buildRegisterDeepLink({ sparkAddress, label, origin, network, mode: spendMode })
  if (!href) throw new Error('Could not build the deep link for the new pot.')

  const openResult = await d.promptOpenLink(href)
  lines.push(
    `Pot address: ${sparkAddress}`,
    `Spend mode: ${spendMode === 'free' ? 'auth not required (free)' : 'auth required'}`,
    `Key file written (mode 0600): ${keyFile}`,
    'Set ZAPPI_POT_SEED as a host secret. Do not cat or print the file.',
    `Approve in Zappi (human signs in and taps Register):`,
    href,
    '',
    'Never print, email, or paste the mnemonic into chat or this link.',
  )
  if (openResult.action === 'copied') {
    lines.push('Link copied to clipboard.')
  } else if (openResult.action === 'skipped') {
    lines.push('Could not copy — open the link above manually.')
  }
  return {
    mode,
    spendMode,
    label,
    sparkAddress,
    keyFile,
    href,
    openResult,
    output: lines.join('\n'),
  }
}
