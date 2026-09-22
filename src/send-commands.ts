import { parseArgs, parseIntFlag } from './args.js'
import type { OutputMode } from './ui.js'
import { infoLine, kv, warnLine } from './ui.js'
import { runSendExternal, runSendInternal } from './withdraw-commands.js'

const NL = String.fromCharCode(10)
const SEND_USAGE =
  'Usage: zappi-cli send --to <address|@user> --amount-cents <n> [--asset usdc|usdt|btc] [--network <id>] [--dry-run] [--idempotency-key <k>]' +
  NL +
  '   or: zappi-cli send <internal|external> ...'

export type SendRoute = 'internal' | 'external'

/**
 * Route a `--to` destination: `@user` / bare id → Nest internal P2P;
 * address with asset+network → Nest external (Orchestra/Spark rail picker).
 */
export function classifySendTarget(
  to: string,
  strings: Record<string, string>,
): SendRoute {
  const trimmed = to.trim()
  if (trimmed.startsWith('@')) return 'internal'
  if (strings.asset && strings.network) return 'external'
  if (!strings.asset && !strings.network) return 'internal'
  return 'external'
}

function resolveAmountCents(strings: Record<string, string>): number {
  const raw = strings['amount-cents'] ?? strings.amount
  return parseIntFlag(
    raw,
    strings['amount-cents'] != null ? 'amount-cents' : 'amount',
  )
}

function stripAt(to: string): string {
  return to.startsWith('@') ? to.slice(1) : to
}

/**
 * Unified pot send (1-315). Free-pot path first; Nest picks external rail.
 * Keeps `pay` = paywall only.
 */
export async function runSend(
  argv: string[],
  mode: OutputMode,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const { strings, booleans } = parseArgs(argv)
  const to = strings.to
  if (!to) throw new Error(SEND_USAGE)

  const amountCents = resolveAmountCents(strings)
  const route = classifySendTarget(to, strings)
  const idempotencyKey = strings['idempotency-key']
  const potId = strings['pot-id'] ?? env.ZAPPI_POT_ID

  if (booleans['dry-run']) {
    const plan = {
      ok: true as const,
      dryRun: true as const,
      route,
      to: route === 'internal' ? stripAt(to) : to,
      amountCents,
      asset: strings.asset ?? null,
      network: strings.network ?? null,
      potId: potId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      note: 'auth_required pots not implemented in CLI send yet (free-pot path)',
    }
    if (mode === 'json') return JSON.stringify(plan, null, 2)
    if (mode === 'plain') {
      return `dry-run route=${route} to=${plan.to} amountCents=${amountCents}`
    }
    return [
      infoLine('Dry-run send plan', mode),
      kv('route', route, mode),
      kv('to', plan.to, mode),
      kv('amount', `${amountCents}¢`, mode),
      ...(plan.asset ? [kv('asset', plan.asset, mode)] : []),
      ...(plan.network ? [kv('network', plan.network, mode)] : []),
      warnLine('auth_required left open — free-pot path only', mode),
    ].join(NL)
  }

  if (route === 'internal') {
    const forwarded = [
      '--to',
      stripAt(to),
      '--amount',
      String(amountCents),
      ...(strings.memo ? ['--memo', strings.memo] : []),
      ...(strings.auth ? ['--auth', strings.auth] : []),
      ...(idempotencyKey ? ['--idempotency-key', idempotencyKey] : []),
    ]
    return runSendInternal(forwarded, mode, env)
  }

  if (!strings.asset || !strings.network) {
    throw new Error(
      'External send needs --asset and --network (Nest withdraw catalog).' +
        NL +
        SEND_USAGE,
    )
  }
  const forwarded = [
    '--asset',
    strings.asset,
    '--network',
    strings.network,
    '--address',
    to,
    '--amount',
    String(amountCents),
    ...(strings.auth ? ['--auth', strings.auth] : []),
    ...(idempotencyKey ? ['--idempotency-key', idempotencyKey] : []),
  ]
  return runSendExternal(forwarded, mode, env)
}
