import { parseArgs, parseIntFlag } from './args.js'
import { loadPotSeed } from './load-pot-seed.js'
import { resolveSparkNetwork, type PotEnv } from './env.js'
import {
  inspectSparkAddress,
  looksLikeSparkAddress,
} from './spark-address.js'
import {
  readUsdbTokenIdentifier,
  sendUsdbFromPot,
} from './spark-send.js'
import type { OutputMode } from './ui.js'
import {
  errorLine,
  infoLine,
  kv,
  successLine,
  warnLine,
} from './ui.js'
import { runSendExternal, runSendInternal } from './withdraw-commands.js'

const NL = String.fromCharCode(10)
const SEND_USAGE =
  'Usage: zappi-cli send --to <address|@user|spark…> --amount-cents <n> [--asset usdc|usdt|btc] [--network <id>] [--dry-run] [--idempotency-key <k>]' +
  NL +
  '   or: zappi-cli send <internal|external> ...'

export type SendRoute = 'internal' | 'external' | 'spark'

/**
 * Route a `--to` destination:
 * - Spark bech32 (`spark1…` / `sparkrt1…`) → pot-signed Spark USDB P2P
 * - `@user` / bare id → Nest internal P2P
 * - otherwise with asset+network → Nest external (Orchestra catalog)
 */
export function classifySendTarget(
  to: string,
  strings: Record<string, string> = {},
): SendRoute {
  const trimmed = to.trim()
  if (looksLikeSparkAddress(trimmed)) return 'spark'
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

function jsonOut(result: unknown): string {
  return JSON.stringify(result, null, 2)
}

/**
 * Pot → Spark address USDB transfer (no Nest Orchestra catalog).
 * Same signer path as paywall settle / prior pot USDB sends.
 */
async function runSendSparkUsdb(
  to: string,
  amountCents: number,
  mode: OutputMode,
  env: PotEnv,
): Promise<string> {
  const inspected = inspectSparkAddress(to)
  if (!inspected.valid || !inspected.network || inspected.network === 'FOREIGN') {
    throw new Error(
      'Destination is not a valid Spark address for MAINNET/REGTEST: ' + to,
    )
  }
  const potNetwork = resolveSparkNetwork(env)
  if (inspected.network !== potNetwork) {
    throw new Error(
      'Spark address network is ' +
        inspected.network +
        ' but pot SPARK_NETWORK is ' +
        potNetwork +
        '.',
    )
  }

  const mnemonic = loadPotSeed(env)
  const tokenIdentifier = await readUsdbTokenIdentifier(mnemonic, 0, potNetwork)
  const { sparkTxHash } = await sendUsdbFromPot({
    mnemonic,
    accountNumber: 0,
    network: potNetwork,
    tokenIdentifier,
    receiverSparkAddress: to.trim(),
    amountCents,
  })

  const result = {
    ok: true as const,
    command: 'send spark' as const,
    route: 'spark' as const,
    to: to.trim(),
    amountCents,
    network: potNetwork,
    sparkTxHash,
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return 'tx: ' + sparkTxHash + ' amountCents: ' + amountCents
  }
  return [
    successLine('Spark USDB send complete', mode),
    kv('to', to.trim(), mode),
    kv('amount', amountCents + '¢', mode),
    kv('network', potNetwork, mode),
    kv('tx', sparkTxHash, mode),
  ].join(NL)
}

/**
 * Unified pot send (1-315). Free-pot path first.
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
  const potEnv: NodeJS.ProcessEnv =
    strings['pot-id'] != null && strings['pot-id'] !== ''
      ? { ...env, ZAPPI_POT_ID: strings['pot-id'] }
      : env

  if (booleans['dry-run']) {
    const plan = {
      ok: true as const,
      dryRun: true as const,
      route,
      to: route === 'internal' ? stripAt(to) : to.trim(),
      amountCents,
      asset: strings.asset ?? (route === 'spark' ? 'USDB' : null),
      network: strings.network ?? (route === 'spark' ? 'spark' : null),
      potId: potId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      note:
        route === 'spark'
          ? 'Spark→Spark USDB via pot signer (not Nest withdraw catalog)'
          : 'auth_required pots not implemented in CLI send yet (free-pot path)',
    }
    if (mode === 'json') return jsonOut(plan)
    if (mode === 'plain') {
      return 'dry-run route=' + route + ' to=' + plan.to + ' amountCents=' + amountCents
    }
    return [
      infoLine('Dry-run send plan', mode),
      kv('route', route, mode),
      kv('to', plan.to, mode),
      kv('amount', amountCents + '¢', mode),
      ...(plan.asset ? [kv('asset', plan.asset, mode)] : []),
      ...(plan.network ? [kv('network', plan.network, mode)] : []),
      warnLine(
        route === 'spark'
          ? 'Will sign Spark USDB from pot seed — Nest never holds the mnemonic'
          : 'auth_required left open — free-pot path only',
        mode,
      ),
    ].join(NL)
  }

  if (route === 'spark') {
    return runSendSparkUsdb(to, amountCents, mode, potEnv)
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
    return runSendInternal(forwarded, mode, potEnv)
  }

  if (!strings.asset || !strings.network) {
    throw new Error(
      'External send needs --asset and --network (Nest withdraw catalog).' +
        NL +
        'For Spark USDB P2P use a bare spark/sparkrt1 address with --amount-cents only.' +
        NL +
        SEND_USAGE,
    )
  }

  // Don't invent Orchestra labels for Spark USDB — redirect spark destinations.
  if (looksLikeSparkAddress(to) || /^(usdb|spark)$/i.test(strings.asset) || /^spark$/i.test(strings.network)) {
    return runSendSparkUsdb(to, amountCents, mode, potEnv)
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
  return runSendExternal(forwarded, mode, potEnv)
}

export { runSendSparkUsdb }
