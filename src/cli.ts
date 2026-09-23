#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { redactSecrets } from './paywall-http.js'
import { parsePositiveUnits } from './env.js'
import {
  parseResourceId,
  consumeResourceResult,
  payResourceResult,
} from './paywall.js'
import { runProposeRegister } from './propose-register.js'
import { runInviteLink } from './invite-link.js'
import { runBalance, runTransactions } from './wallet-commands.js'
import {
  runPotsList,
  runPotRegister,
  runPotDepositAddress,
  runPotGrants,
  runPotSpendGate,
  runPotSpendApprovals,
} from './pots-commands.js'
import { runPotAttach, runPotAttachStatus } from './attach-commands.js'
import { runLogin, runLogout, runWhoami } from './login-commands.js'
import { runDepositOptions, runDepositAddress } from './deposit-commands.js'
import {
  runWithdrawOptions,
  runWithdrawEstimate,
  runWithdrawQuote,
  runWithdrawConfirm,
  runWithdrawStatus,
  runSendInternal,
  runSendExternal,
} from './withdraw-commands.js'
import { runSend } from './send-commands.js'
import {
  createSpendRequestResult,
  formatSpendRequestOutput,
  parseRequestCliArgs,
} from './spend-request.js'
import {
  createSpinner,
  renderHelp,
  stripJsonFlag,
  type OutputMode,
} from './ui.js'
import {
  formatConsumePretty,
  formatError,
  formatInvitePlain,
  formatInvitePretty,
  formatPayPretty,
  formatProposePretty,
  toJson,
  type InviteResult,
  type ProposeResult,
} from './results.js'

/** @deprecated Prefer renderHelp(); kept for tests that import HELP. */
export const HELP = renderHelp('plain')

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

export async function runCli(
  argv: string[],
  mode: OutputMode = 'pretty',
): Promise<string> {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h') {
    return renderHelp(mode === 'json' ? 'plain' : mode)
  }

  if (command === 'propose') {
    const output = await runProposeRegister(rest)
    if (mode === 'json') {
      // Best-effort structured propose from plain lines (wizard already printed interactively).
      const address = output.match(/Pot address:\s*(\S+)/)?.[1]
      const href = output
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /^https?:\/\//.test(l))
      const keyFile = output.match(/Key file written[^:]*:\s*(.+)/)?.[1]
      const result: ProposeResult = {
        ok: true,
        command: 'propose',
        mode: keyFile ? 'generate' : 'flags',
        sparkAddress: address ?? '',
        href: href ?? '',
        keyFile,
        copied: /Link copied/i.test(output),
      }
      return toJson(result)
    }
    if (mode === 'pretty' && process.stdout.isTTY) {
      const address = output.match(/Pot address:\s*(\S+)/)?.[1]
      const href = output
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /^https?:\/\//.test(l))
      if (address && href) {
        const keyFile = output.match(/Key file written[^:]*:\s*(.+)/)?.[1]
        return formatProposePretty({
          ok: true,
          command: 'propose',
          mode: keyFile ? 'generate' : 'flags',
          sparkAddress: address,
          href,
          keyFile,
          copied: /Link copied/i.test(output),
        })
      }
    }
    return output
  }

  if (command === 'request') {
    const args = parseRequestCliArgs(rest)
    const spinner = createSpinner('Requesting approval…', mode)
    spinner.start()
    try {
      const result = await createSpendRequestResult({ input: args })
      spinner.stop()
      return formatSpendRequestOutput(result, mode === 'json' ? 'json' : 'plain')
    } catch (error) {
      spinner.fail('Request failed')
      throw error
    }
  }

  if (command === 'pay') {
    const args = parsePayCliArgs(rest)
    if (!args.resourceArg) {
      throw new Error(
        'Usage: zappi-cli pay <resourceIdOrUrl> [--no-consume] [--units N] [--json]',
      )
    }
    const spinner = createSpinner('Paying…', mode)
    spinner.start('Checking resource…')
    try {
      const result = await payResourceResult(parseResourceId(args.resourceArg), {
        autoConsume: !args.noConsume,
        consumeUnits: args.units,
        onStatus: (label) => spinner.setText(label),
      })
      spinner.succeed(
        result.status === 'already_unlocked' ? 'Already unlocked' : 'Settled',
      )
      if (mode === 'json') return toJson(result)
      if (mode === 'plain') {
        const { formatPayPlain } = await import('./results.js')
        return formatPayPlain(result)
      }
      return formatPayPretty(result, mode)
    } catch (error) {
      spinner.fail('Pay failed')
      throw error
    }
  }

  if (command === 'consume') {
    const args = parseConsumeCliArgs(rest)
    if (!args.resourceArg) {
      throw new Error(
        'Usage: zappi-cli consume <resourceIdOrUrl> [--units N] [--unlock-token <token>] [--json]',
      )
    }
    const spinner = createSpinner('Consuming…', mode)
    spinner.start()
    try {
      const result = await consumeResourceResult(
        parseResourceId(args.resourceArg),
        {
          units: args.units,
          unlockToken: args.unlockTokenFlag,
        },
      )
      spinner.succeed('Consumed')
      if (mode === 'json') return toJson(result)
      if (mode === 'plain') {
        const { formatConsumePlain } = await import('./results.js')
        return formatConsumePlain(result)
      }
      return formatConsumePretty(result, mode)
    } catch (error) {
      spinner.fail('Consume failed')
      throw error
    }
  }

  if (command === 'login') {
    return runLogin(rest, mode)
  }

  if (command === 'logout') {
    return runLogout(rest, mode)
  }

  if (command === 'whoami') {
    return runWhoami(rest, mode)
  }

  /* ----------------------------- wallet routes ----------------------------- */

  if (command === 'balance') {
    return runBalance(rest, mode)
  }

  if (command === 'transactions') {
    return runTransactions(rest, mode)
  }

  if (command === 'deposit-options') {
    return runDepositOptions(rest, mode)
  }

  if (command === 'deposit-address') {
    return runDepositAddress(rest, mode)
  }

  if (command === 'withdraw-options') {
    return runWithdrawOptions(rest, mode)
  }

  if (command === 'withdraw') {
    const sub = rest.find((a) => !a.startsWith('-')) ?? rest[0]
    const subRest = rest.filter((a) => a !== sub)
    if (sub === 'estimate') return runWithdrawEstimate(subRest, mode)
    if (sub === 'quote') return runWithdrawQuote(subRest, mode)
    if (sub === 'confirm') return runWithdrawConfirm(subRest, mode)
    if (sub === 'status') return runWithdrawStatus(subRest, mode)
    throw new Error(
      `Usage: zappi-cli withdraw <estimate|quote|confirm|status> ...\n\n${renderHelp(mode === 'json' ? 'plain' : mode)}`,
    )
  }

  if (command === 'send') {
    const sub = rest.find((a) => !a.startsWith('-'))
    if (sub === 'internal' || sub === 'external') {
      const subRest = rest.filter((a) => a !== sub)
      if (sub === 'internal') return runSendInternal(subRest, mode)
      return runSendExternal(subRest, mode)
    }
    // Unified: zappi-cli send --to <address|@user> --amount-cents <n> ...
    return runSend(rest, mode)
  }

  /* -------------------------------- pots ---------------------------------- */

  if (command === 'pots') {
    // First non-flag arg is the subcommand; flags-only (e.g. `pots --json`) means `list`.
    const sub = rest.find((a) => !a.startsWith('-'))
    const subRest = sub ? rest.filter((a) => a !== sub) : rest
    if (!sub || sub === 'list') return runPotsList(subRest, mode)
    if (sub === 'register') return runPotRegister(subRest, mode)
    if (sub === 'deposit-address') return runPotDepositAddress(subRest, mode)
    if (sub === 'grants') return runPotGrants(subRest, mode)
    if (sub === 'spend-gate') return runPotSpendGate(subRest, mode)
    if (sub === 'spend-approvals') return runPotSpendApprovals(subRest, mode)
    if (sub === 'attach') return runPotAttach(subRest, mode)
    if (sub === 'attach-status') return runPotAttachStatus(subRest, mode)
    throw new Error(
      `Usage: zappi-cli pots <list|register|deposit-address|grants|spend-gate|spend-approvals|attach|attach-status> ...\n\n${renderHelp(mode === 'json' ? 'plain' : mode)}`,
    )
  }

  throw new Error(`Unknown command: ${command}\n\n${renderHelp(mode === 'json' ? 'plain' : mode)}`)
}

async function main(argv: string[]) {
  const { json, argv: rest } = stripJsonFlag(argv)
  const mode: OutputMode = json ? 'json' : 'pretty'
  const output = await runCli(rest, mode)
  process.stdout.write(`${output}\n`)
}

// Works through the `zappi-cli` bin symlink too: argv[1] is the symlink, so
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
    const { json } = stripJsonFlag(process.argv.slice(2))
    const mode: OutputMode = json ? 'json' : 'pretty'
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${formatError(redactSecrets(message), mode)}\n`)
    process.exitCode = 1
  })
}
