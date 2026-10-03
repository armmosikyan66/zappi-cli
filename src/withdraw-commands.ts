import {
  runTwoPhaseWithdraw,
  type TwoPhaseSigner,
  type WithdrawalRequest,
} from '@zappimoney/zappi-sdk'
import { resolveZappiClient } from './client.js'
import {
  potResolveSendTarget,
  potSendExternal,
  potSendInternal,
} from './pot-send.js'
import { parseArgs, parseIntFlag } from './args.js'
import { assertFreeSignerSpendMode, type PotEnv } from './env.js'
import { readUsdbTokenIdentifier } from './spark-send.js'
import { gateAndSignFreePot } from './free-pot-sign.js'
import { resolvePotContext, type PotContext } from './pot-context.js'
import {
  errorLine,
  heading,
  infoLine,
  kv,
  successLine,
  warnLine,
  type OutputMode,
} from './ui.js'

const NL = '\n'
const USDB_MICRO_UNITS_PER_CENT = 10_000n
const UNKNOWN = 'unknown'

/** Finite epoch millis. Expired values are returned so a journaled retry can reconcile before a new sign. */
function parseQuoteExpiry(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return ms
  }
  throw new Error('Quote expiry is missing or invalid. Refusing to sign.')
}

function jsonOut(result: unknown): string {
  return JSON.stringify(result, null, 2)
}

function withdrawError(message: string, mode: OutputMode): string {
  if (mode === 'json') return jsonOut({ ok: false, error: message })
  if (mode === 'plain') return message
  return errorLine(message, mode)
}

/**
 * Adapter that satisfies the SDK {@link TwoPhaseSigner} interface by signing
 * Spark USDB transfers from the host pot seed. The pot key never leaves the
 * host; only the resulting `sparkTxHash` is sent to nest.
 */
function buildPotSigner(
  env: PotEnv,
  externalIdempotencyKey?: string,
  potFlag?: string,
  context?: PotContext,
): TwoPhaseSigner {
  return {
    async transferUsdb(params: {
      tokenIdentifier: string
      tokenAmount: bigint
      receiverSparkAddress: string
    }): Promise<{ sparkTxHash: string }> {
      if (params.tokenAmount % USDB_MICRO_UNITS_PER_CENT !== 0n) {
        throw new Error('Withdraw amount is not an exact number of cents. Refusing to sign.')
      }
      const amountCents = Number(params.tokenAmount / USDB_MICRO_UNITS_PER_CENT)
      const { sparkTxHash } = await gateAndSignFreePot({
        env,
        ...(potFlag ? { selectors: { potFlag } } : {}),
        ...(context ? { resolveContext: async () => context } : {}),
        kind: 'send',
        receiver: params.receiverSparkAddress,
        amountCents,
        tokenIdentifier: params.tokenIdentifier,
        ...(externalIdempotencyKey ? { externalIdempotencyKey } : {}),
        journal: { env },
        readTokenIdentifier: readUsdbTokenIdentifier,
      })
      return { sparkTxHash }
    },
  }
}

/** Build a WithdrawalRequest from CLI string flags. */
function buildWithdrawalRequest(strings: Record<string, string>): WithdrawalRequest {
  const asset = strings.asset
  const network = strings.network
  const address = strings.address
  const bolt11 = strings.bolt11
  if (!asset || !network) {
    throw new Error('--asset and --network are required')
  }
  if (!address && !bolt11) {
    throw new Error('--address (on-chain) or --bolt11 (lightning) is required')
  }
  const req: WithdrawalRequest = {
    combo: { asset, network } as WithdrawalRequest['combo'],
  }
  if (address) req.destinationAddress = address
  if (bolt11) req.bolt11 = bolt11
  if (strings.amount) {
    const cents = parseIntFlag(strings.amount, 'amount')
    req.amountCents = cents
  }
  if (strings.sats) req.amountSats = parseIntFlag(strings.sats, 'sats')
  return req
}

/** `zappi-cli withdraw-options` */
export async function runWithdrawOptions(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  void argv
  const client = await resolveZappiClient(env)
  const options = await client.getWithdrawOptions()
  const result = { ok: true as const, command: 'withdraw-options' as const, options }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    if (options.length === 0) return 'No withdraw options.'
    return options.map((o) => o.asset + ': ' + o.networks.map((n) => n.id).join(',')).join(NL)
  }
  if (options.length === 0) return infoLine('No withdraw options.', mode)
  const lines = [heading('Withdraw options', mode)]
  for (const o of options) {
    lines.push(successLine(o.asset, mode))
    for (const n of o.networks) {
      lines.push('  ' + kv('network', n.id, mode) + ' ' + kv('arrival', n.estimatedArrivalCopy, mode))
    }
  }
  return lines.join(NL)
}

/** `zappi-cli withdraw estimate --asset --network --address --amount` */
export async function runWithdrawEstimate(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { strings } = parseArgs(argv)
  const client = await resolveZappiClient(env)
  const req = buildWithdrawalRequest(strings)
  const estimate = await client.estimateWithdrawal(req)
  const result = { ok: true as const, command: 'withdraw estimate' as const, estimate }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    const net = estimate.netReceivedCents ?? estimate.netReceivedSats ?? UNKNOWN
    const fee = estimate.networkFeeCents ?? estimate.networkFeeSats ?? UNKNOWN
    return 'net: ' + net + ' fee: ' + fee
  }
  return [
    heading('Withdraw estimate', mode),
    kv('gross', String(estimate.grossAmountCents ?? estimate.grossAmountSats ?? UNKNOWN), mode),
    kv('fee', String(estimate.networkFeeCents ?? estimate.networkFeeSats ?? UNKNOWN), mode),
    kv('net', String(estimate.netReceivedCents ?? estimate.netReceivedSats ?? UNKNOWN), mode),
    ...(estimate.estimatedArrivalCopy ? [kv('arrival', estimate.estimatedArrivalCopy, mode)] : []),
  ].join(NL)
}

/** `zappi-cli withdraw quote --asset --network --address --amount` */
export async function runWithdrawQuote(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { strings } = parseArgs(argv)
  const client = await resolveZappiClient(env)
  const req = buildWithdrawalRequest(strings)
  const quote = await client.getWithdrawalQuote(req)
  const result = { ok: true as const, command: 'withdraw quote' as const, quote }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return 'quoteId: ' + quote.quoteId + ' expires: ' + quote.expiresAt
  }
  return [
    heading('Withdraw quote', mode),
    kv('quoteId', quote.quoteId, mode),
    kv('expires', quote.expiresAt, mode),
    kv('net', String(quote.netReceivedCents ?? quote.netReceivedSats ?? UNKNOWN), mode),
    kv('arrival', quote.estimatedArrivalCopy, mode),
  ].join(NL)
}

export interface MoneyOutHooks {
  /** Test hook after the verified pot is chosen and before Nest or signing. */
  onContext?: (context: PotContext) => void
  /** Test double for Spark address derivation. Production uses the SDK. */
  deriveAddress?: (seed: string, network: 'MAINNET' | 'REGTEST', accountIndex: number) => Promise<string>
}

/** `zappi-cli withdraw confirm <quoteId> [--auth <token>] [--pot <id>]` */
export async function runWithdrawConfirm(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  hooks?: MoneyOutHooks,
): Promise<string> {
  const { positionals, strings } = parseArgs(argv)
  const quoteId = positionals[0]
  if (!quoteId) throw new Error('Usage: zappi-cli withdraw confirm <quoteId> [--auth <token>]')
  const potFlag = strings.pot ?? strings['pot-id']
  if (strings.pot && strings['pot-id'] && strings.pot !== strings['pot-id']) {
    throw new Error(
      `Conflicting pot selectors: --pot ${strings.pot} but --pot-id ${strings['pot-id']}. Pick one.`,
    )
  }
  assertFreeSignerSpendMode(env)
  // Resolve before Nest so --pot B cannot fall through to ZAPPI_POT_ID A.
  const context = await resolvePotContext(potFlag ? { potFlag } : {}, {
    env,
    ...(hooks?.deriveAddress ? { deriveAddress: hooks.deriveAddress } : {}),
  })
  hooks?.onContext?.(context)
  const client = await resolveZappiClient(env)
  const signer = buildPotSigner(env, quoteId, potFlag, context)
  const authorizationToken = strings.auth ?? null
  const confirmation = await runTwoPhaseWithdraw(client, signer, {
    quoteId,
    authorizationToken,
  })
  const result = { ok: true as const, command: 'withdraw confirm' as const, confirmation }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return 'withdrawalId: ' + confirmation.withdrawalId + ' status: ' + confirmation.status
  }
  return [
    successLine('Withdraw confirmed', mode),
    kv('withdrawalId', confirmation.withdrawalId, mode),
    kv('status', confirmation.status, mode),
    ...(confirmation.needsSignature
      ? [warnLine('Still needs signature — retry after signing.', mode)]
      : []),
  ].join(NL)
}

/** `zappi-cli withdraw status <id>` */
export async function runWithdrawStatus(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals } = parseArgs(argv)
  const id = positionals[0]
  if (!id) throw new Error('Usage: zappi-cli withdraw status <id>')
  const client = await resolveZappiClient(env)
  const status = await client.getWithdrawalStatus(id)
  const result = { ok: true as const, command: 'withdraw status' as const, status }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return 'id: ' + status.id + ' status: ' + status.status
  }
  return [
    heading('Withdraw status', mode),
    kv('id', status.id, mode),
    kv('status', status.status, mode),
    kv('destination', status.destinationDisplay, mode),
    ...(status.failureReasonCopy ? [warnLine(status.failureReasonCopy, mode)] : []),
  ].join(NL)
}


/** `zappi-cli send internal --to <userId> --amount <cents>` — Nest pot-scoped P2P (1-315). */
export async function runSendInternal(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  hooks?: MoneyOutHooks,
): Promise<string> {
  const { strings } = parseArgs(argv)
  const recipientUserId = strings.to
  if (!recipientUserId || !strings.amount) {
    throw new Error(
      'Usage: zappi-cli send internal --to <userId> --amount <cents> [--memo L] [--auth <token>]',
    )
  }
  const amountCents = parseIntFlag(strings.amount, 'amount')
  assertFreeSignerSpendMode(env)
  const potFlag = strings.pot ?? strings['pot-id']
  if (strings.pot && strings['pot-id'] && strings.pot !== strings['pot-id']) {
    throw new Error(
      `Conflicting pot selectors: --pot ${strings.pot} but --pot-id ${strings['pot-id']}. Pick one.`,
    )
  }
  const context = await resolvePotContext(potFlag ? { potFlag } : {}, {
    env,
    ...(hooks?.deriveAddress ? { deriveAddress: hooks.deriveAddress } : {}),
  })
  hooks?.onContext?.(context)
  const potId = context.potId
  const client = await resolveZappiClient(env)
  const authorizationToken = strings.auth ?? null
  const callerKey = strings['idempotency-key']

  const target = await potResolveSendTarget(client, potId, recipientUserId)
  if (!target.destinationSparkAddress) {
    throw new Error(
      'Recipient ' +
        recipientUserId +
        ' has no destination Spark address (custody: ' +
        String(target.recipientCustody ?? 'unknown') +
        ').',
    )
  }

  const idempotencyKey =
    callerKey ??
    ['internal', potId, recipientUserId, String(amountCents), target.destinationSparkAddress].join('\u0000')

  await potSendInternal(
    client,
    potId,
    {
      recipientUserId,
      amountCents,
      idempotencyKey,
      ...(strings.memo ? { memo: strings.memo } : {}),
    },
    authorizationToken,
  )

  const signed = await gateAndSignFreePot({
    env,
    kind: 'send',
    receiver: target.destinationSparkAddress,
    amountCents,
    externalIdempotencyKey: idempotencyKey,
    journal: { env },
    resolveContext: async () => context,
    readTokenIdentifier: readUsdbTokenIdentifier,
  })
  const sparkTxHash = signed.sparkTxHash

  const confirmation = await potSendInternal(
    client,
    potId,
    {
      recipientUserId,
      amountCents,
      idempotencyKey,
      sparkTxHash,
      destinationSparkAddress: target.destinationSparkAddress,
      ...(strings.memo ? { memo: strings.memo } : {}),
    },
    authorizationToken,
  )

  const result = {
    ok: true as const,
    command: 'send internal' as const,
    potId,
    recipientUserId,
    amountCents,
    sparkTxHash,
    confirmation,
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return (
      'transferId: ' +
      String(confirmation.transferId ?? '-') +
      ' status: ' +
      String(confirmation.status ?? '-') +
      ' tx: ' +
      sparkTxHash
    )
  }
  return [
    successLine('Internal send complete', mode),
    kv('pot', potId, mode),
    kv('to', recipientUserId, mode),
    kv('amount', amountCents + '¢', mode),
    kv('tx', sparkTxHash, mode),
    ...(confirmation.transferId
      ? [kv('transferId', String(confirmation.transferId), mode)]
      : []),
    ...(confirmation.status
      ? [kv('status', String(confirmation.status), mode)]
      : []),
  ].join(NL)
}

/** `zappi-cli send external` — Nest pot-scoped catalog withdraw (1-315). */
export async function runSendExternal(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  hooks?: MoneyOutHooks,
): Promise<string> {
  const { strings } = parseArgs(argv)
  const asset = strings.asset
  const network = strings.network
  const address = strings.address
  const amount = strings.amount
  if (!asset || !network || !address || !amount) {
    throw new Error(
      'Usage: zappi-cli send external --asset <a> --network <n> --address <addr> --amount <cents> [--auth <token>]',
    )
  }
  const amountCents = parseIntFlag(amount, 'amount')
  assertFreeSignerSpendMode(env)
  const potFlag = strings.pot ?? strings['pot-id']
  if (strings.pot && strings['pot-id'] && strings.pot !== strings['pot-id']) {
    throw new Error(
      `Conflicting pot selectors: --pot ${strings.pot} but --pot-id ${strings['pot-id']}. Pick one.`,
    )
  }
  const context = await resolvePotContext(potFlag ? { potFlag } : {}, {
    env,
    ...(hooks?.deriveAddress ? { deriveAddress: hooks.deriveAddress } : {}),
  })
  hooks?.onContext?.(context)
  if (asset.toUpperCase() !== 'USDB') {
    throw new Error(
      `External send asset ${asset} is unsupported on the free signer; this CLI can only sign USDB.`,
    )
  }
  const potId = context.potId
  const client = await resolveZappiClient(env)
  const authorizationToken = strings.auth ?? null
  const callerKey = strings['idempotency-key']
  const idempotencyKey =
    callerKey ??
    ['external', potId, asset.toUpperCase(), network, address, String(amountCents)].join('\u0000')

  const first = await potSendExternal(
    client,
    potId,
    {
      asset,
      networkId: network,
      address,
      amountCents,
      idempotencyKey,
    },
    authorizationToken,
  )

  let final = first
  if (
    first.needsSignature &&
    first.depositAddress &&
    first.tokenIdentifier &&
    first.sendAmount
  ) {
    const sendAmountUnits = BigInt(first.sendAmount)
    if (sendAmountUnits % USDB_MICRO_UNITS_PER_CENT !== 0n) {
      throw new Error('Quote send amount is not an exact number of cents. Refusing to sign.')
    }
    const amountCentsFromUnits = Number(sendAmountUnits / USDB_MICRO_UNITS_PER_CENT)
    if (amountCentsFromUnits !== amountCents) {
      throw new Error(
        `Quote send amount ${amountCentsFromUnits}¢ does not match the requested ${amountCents}¢. Refusing to sign.`,
      )
    }
    const quoteExpiryMs = parseQuoteExpiry(first.expiresAt)
    const signed = await gateAndSignFreePot({
      env,
      kind: 'send',
      receiver: first.depositAddress,
      amountCents: amountCentsFromUnits,
      tokenIdentifier: first.tokenIdentifier,
      ...(first.accountNumber !== undefined ? { accountNumber: first.accountNumber } : {}),
      quoteExpiryMs,
      requireQuoteExpiry: true,
      externalIdempotencyKey: idempotencyKey,
      journal: { env },
      resolveContext: async () => context,
      readTokenIdentifier: readUsdbTokenIdentifier,
    })
    final = await potSendExternal(
      client,
      potId,
      {
        asset,
        networkId: network,
        address,
        amountCents,
        idempotencyKey,
        sparkTxHash: signed.sparkTxHash,
      },
      authorizationToken,
    )
  }

  const result = {
    ok: true as const,
    command: 'send external' as const,
    potId,
    asset,
    network,
    address,
    amountCents,
    withdrawId: final.withdrawId ?? null,
    status: final.status,
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return (
      'withdrawId: ' +
      (final.withdrawId ?? '-') +
      ' status: ' +
      String(final.status ?? '-')
    )
  }
  return [
    successLine('External send submitted', mode),
    kv('pot', potId, mode),
    kv('asset', asset, mode),
    kv('network', network, mode),
    kv('amount', amountCents + '¢', mode),
    kv('status', String(final.status ?? '-'), mode),
    ...(final.withdrawId
      ? [kv('withdrawId', String(final.withdrawId), mode)]
      : []),
  ].join(NL)
}

export { withdrawError }
