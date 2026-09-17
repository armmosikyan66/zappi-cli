#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { redactSecrets } from './paywall-http.js'
import { parsePositiveUnits } from './env.js'
import { parseResourceId, consumeResource, payResource } from './paywall.js'
import { runProposeRegister } from './propose-register.js'

export const HELP = `zappi-pot — buyer CLI for Zappi agent pots

Commands:
  propose   Interactive wizard: existing pot or generate a new one, pick a pot
            label (blank = auto pot_<id>), then open the Zappi register link
            in your browser (ENTER to open, auto-opens after a few seconds,
            or "c" to copy). Flags (--address/--generate) still work for
            scripts. Never prints the mnemonic.
  pay       Pay a nest PaidResource (402 → sign from pot → settle)
            Metered resources auto-consume one unit after settle
            (opt out with --no-consume)
  consume   Burn metered grant units (POST …/consume)

Env:
  ZAPPI_POT_ID          Required for pay (pot id from the Zappi prompt)
  ZAPPI_POT_SEED        Preferred pot key (host secret — never echo)
  ZAPPI_POT_KEY_FILE    Fallback mode-0600 key file
  ZAPPI_API_URL         Nest origin (default https://api.zappi.money)
  ZAPPI_PAYWALL_BASE    Optional override of the paywall origin
  ZAPPI_UNLOCK_TOKEN    Unlock bearer for consume (preferred over --unlock-token)
  ZAPPI_APP_ORIGIN      Web origin for propose links (default http://dev.zappi.money)
  SPARK_NETWORK         MAINNET (default) or REGTEST

Staging dogfood:
  ZAPPI_API_URL=https://api-dev.zappi.money

Examples:
  zappi-pot propose                     # interactive wizard
  zappi-pot propose --generate --label Research --open
  zappi-pot pay <resourceId>
  zappi-pot pay <resourceId> --no-consume
  zappi-pot consume <resourceId> [--units N]
  zappi-pot pay https://api.zappi.money/api/paywall/resources/<id>

Never print or log ZAPPI_POT_SEED, the key file, or ZAPPI_UNLOCK_TOKEN.`

export interface PayCliArgs {
  resourceArg?: string
  noConsume: boolean
  units: number
}

export interface ConsumeCliArgs {
  resourceArg?: string
  units: number
  unlockTokenFlag?: string
}

export function parsePayCliArgs(argv: string[]): PayCliArgs {
  const parsed: PayCliArgs = { noConsume: false, units: 1 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--no-consume') {
      parsed.noConsume = true
    } else if (arg === '--units' && next) {
      parsed.units = parsePositiveUnits(next)
      index += 1
    } else if (!arg.startsWith('-') && !parsed.resourceArg) {
      parsed.resourceArg = arg
    } else if (arg === '--help' || arg === '-h') {
      throw new Error(HELP)
    }
  }
  return parsed
}

export function parseConsumeCliArgs(argv: string[]): ConsumeCliArgs {
  const parsed: ConsumeCliArgs = { units: 1 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--units' && next) {
      parsed.units = parsePositiveUnits(next)
      index += 1
    } else if (arg === '--unlock-token' && next) {
      parsed.unlockTokenFlag = next
      index += 1
    } else if (!arg.startsWith('-') && !parsed.resourceArg) {
      parsed.resourceArg = arg
    } else if (arg === '--help' || arg === '-h') {
      throw new Error(HELP)
    }
  }
  return parsed
}

export async function runCli(argv: string[]): Promise<string> {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h') {
    return HELP
  }

  if (command === 'propose') {
    return runProposeRegister(rest)
  }

  if (command === 'pay') {
    const args = parsePayCliArgs(rest)
    if (!args.resourceArg) {
      throw new Error(
        'Usage: zappi-pot pay <resourceIdOrUrl> [--no-consume] [--units N]',
      )
    }
    return payResource(parseResourceId(args.resourceArg), {
      autoConsume: !args.noConsume,
      consumeUnits: args.units,
    })
  }

  if (command === 'consume') {
    const args = parseConsumeCliArgs(rest)
    if (!args.resourceArg) {
      throw new Error(
        'Usage: zappi-pot consume <resourceIdOrUrl> [--units N] [--unlock-token <token>]',
      )
    }
    return consumeResource(parseResourceId(args.resourceArg), {
      units: args.units,
      unlockToken: args.unlockTokenFlag,
    })
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`)
}

async function main(argv: string[]) {
  const output = await runCli(argv)
  process.stdout.write(`${output}\n`)
}

// Works through the `zappi-pot` bin symlink too: argv[1] is the symlink, so
// resolve it to the real file and compare against this module's own path.
const isDirectRun = (() => {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    )
  } catch {
    return false
  }
})()

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${redactSecrets(message)}\n`)
    process.exitCode = 1
  })
}
