import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { resolveAppOrigin, resolveSparkNetwork, type PotEnv } from './env.js'
import {
  buildRegisterDeepLink,
  parseRegisterDeepLinkQuery,
} from './register-deep-link.js'

export interface ProposeRegisterArgs {
  address?: string
  label?: string
  origin: string
  generate: boolean
  open: boolean
  keyFile?: string
}

const USAGE = `Usage:
  zappi-pot propose --address spark1… [--label Research] [--origin https://zappi.money] [--open]
  zappi-pot propose --generate [--label Research] [--key-file ~/.zappi/new-pot.txt] [--open]

Generates or accepts a public pot address, prints the P0 register deep link,
and never prints the mnemonic. The human signs in and taps Register.
Do not pass a recovery phrase as --address.`

export function parseProposeRegisterArgs(
  argv: string[],
  env: PotEnv = process.env,
): ProposeRegisterArgs {
  const parsed: ProposeRegisterArgs = {
    origin: resolveAppOrigin(env),
    generate: false,
    open: false,
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
      'Do not pass a recovery phrase. Pass the public spark1 address only.',
    )
  }
  if (parsed.status !== 'ok') {
    throw new Error(
      'Pass a public spark1 pot address as --address (Bech32m checksum, matching network).',
    )
  }

  const href = buildRegisterDeepLink({
    sparkAddress: parsed.sparkAddress,
    label: parsed.label,
    origin: input.origin,
    network: input.network,
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
    'Never print, email, or paste the mnemonic into chat or this link.',
  ].join('\n')
}

function defaultKeyFile(): string {
  return join(homedir(), '.zappi', `new-pot-${Date.now()}.txt`)
}

function writeKeyFile(
  path: string,
  mnemonic: string,
  sparkAddress: string,
  label?: string,
) {
  mkdirSync(dirname(path), { recursive: true })
  const body = [
    'Zappi agent pot key',
    label ? `Label: ${label}` : null,
    `Wallet address: ${sparkAddress}`,
    '',
    'This file is the pot spend key. Store it as a host secret (ZAPPI_POT_SEED)',
    'or chmod 0600 on the agent machine. Never paste it into chat.',
    '',
    mnemonic,
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
  writeFileSync(path, body, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

async function deriveSparkAddress(
  mnemonic: string,
  network: 'MAINNET' | 'REGTEST',
): Promise<string> {
  const { SparkWallet } = await import('@buildonspark/spark-sdk')
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: mnemonic,
    accountNumber: 0,
    options: { network },
  })
  try {
    return await wallet.getSparkAddress()
  } finally {
    await wallet.cleanupConnections()
  }
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
  const args = parseProposeRegisterArgs(argv, env)
  const network = resolveSparkNetwork(env)
  let sparkAddress = args.address?.trim()

  if (args.generate) {
    const mnemonic = generateMnemonic(wordlist, 128)
    sparkAddress = await deriveSparkAddress(mnemonic, network)
    const keyFile = args.keyFile?.trim() || defaultKeyFile()
    writeKeyFile(keyFile, mnemonic, sparkAddress, args.label)
    const printed = printRegisterDeepLink({
      sparkAddress,
      label: args.label,
      origin: args.origin,
      network,
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
  })
  if (args.open) {
    const href = buildRegisterDeepLink({
      sparkAddress: sparkAddress ?? '',
      label: args.label,
      origin: args.origin,
      network,
    })
    if (href) openUrl(href)
  }
  return printed
}
