import {
  runTwoPhaseWithdraw,
  type TwoPhaseSigner,
  type WithdrawalRequest,
} from '@zappimoney/zappi-sdk'
import { resolveZappiClient } from './client.js'
import { parseArgs, parseIntFlag } from './args.js'
import { loadPotSeed } from './load-pot-seed.js'
import { resolveSparkNetwork, type PotEnv } from './env.js'
import {
  readUsdbTokenIdentifier,
  sendUsdbFromPot,
} from './spark-send.js'
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
function buildPotSigner(env: PotEnv): TwoPhaseSigner {
  const mnemonic = loadPotSeed(env)
  const network = resolveSparkNetwork(env)
  return {
    async transferUsdb(params: {
      tokenIdentifier: string
      tokenAmount: bigint
      receiverSparkAddress: string
    }): Promise<{ sparkTxHash: string }> {
      // tokenAmount is in micro-USDB units; convert back to cents.
      const amountCents = Number(params.tokenAmount / USDB_MICRO_UNITS_PER_CENT)
      const { sparkTxHash } = await sendUsdbFromPot({
        mnemonic,
        accountNumber: 0,
        network,
        tokenIdentifier: params.tokenIdentifier,
        receiverSparkAddress: params.receiverSparkAddress,
        amountCents,
      })
      return { sparkTxHash }
    },
  }
}

/** Read the USDB token identifier for the configured pot (used by send internal). */
async function readPotTokenIdentifier(env: PotEnv): Promise<string> {
  const mnemonic = loadPotSeed(env)
  const network = resolveSparkNetwork(env)
  return readUsdbTokenIdentifier(mnemonic, 0, network)
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

/** `zappi-cli withdraw confirm <quoteId> [--auth <token>]` */
export async function runWithdrawConfirm(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals, strings } = parseArgs(argv)
  const quoteId = positionals[0]
  if (!quoteId) throw new Error('Usage: zappi-cli withdraw confirm <quoteId> [--auth <token>]')
  const client = await resolveZappiClient(env)
  const signer = buildPotSigner(env)
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

/** `zappi-cli send internal --to <userId> --amount <cents> [--memo L] [--auth <token>]` */
export async function runSendInternal(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { strings } = parseArgs(argv)
  const recipientUserId = strings.to
  if (!recipientUserId || !strings.amount) {
    throw new Error('Usage: zappi-cli send internal --to <userId> --amount <cents> [--memo L] [--auth <token>]')
  }
  const amountCents = parseIntFlag(strings.amount, 'amount')
  const client = await resolveZappiClient(env)
  const authorizationToken = strings.auth ?? null

  // 1. Resolve the recipient's destination Spark address.
  const target = await client.resolveSendTarget(recipientUserId)
  if (!target.destinationSparkAddress) {
    throw new Error(
      'Recipient ' + recipientUserId + ' has no destination Spark address (custody: ' + target.recipientCustody + ').',
    )
  }

  // 2. Sign the on-chain USDB transfer from the host pot.
  const tokenIdentifier = await readPotTokenIdentifier(env)
  const mnemonic = loadPotSeed(env)
  const network = resolveSparkNetwork(env)
  const { sparkTxHash } = await sendUsdbFromPot({
    mnemonic,
    accountNumber: 0,
    network,
    tokenIdentifier,
    receiverSparkAddress: target.destinationSparkAddress,
    amountCents,
  })

  // 3. Record the send with nest (complete the pending transfer). Use the
  // generic `request` escape hatch because the two-phase send-internal body
  // needs `recipientUserId` + `sparkTxHash` (the nest DTO shape), which the
  // clean `sendInternal(ContactTransferInput)` helper does not carry.
  const idempotencyKey =
    strings['idempotency-key'] ??
    ('cli:send:' + recipientUserId + ':' + amountCents + ':' + Date.now())
  const confirmation = await client.request<{
    ok: true
    transferId: string
    transactionId: string
    status: 'completed' | 'pending' | 'failed'
  }>('wallet/send/internal', {
    method: 'POST',
    body: {
      recipientUserId,
      amountCents,
      destinationType: 'internal',
      idempotencyKey,
      sparkTxHash,
      destinationSparkAddress: target.destinationSparkAddress,
      ...(strings.memo ? { memo: strings.memo } : {}),
    },
    authorizationToken,
  })

  const result = {
    ok: true as const,
    command: 'send internal' as const,
    recipientUserId,
    amountCents,
    sparkTxHash,
    confirmation,
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return 'transferId: ' + confirmation.transferId + ' status: ' + confirmation.status + ' tx: ' + sparkTxHash
  }
  return [
    successLine('Internal send complete', mode),
    kv('to', recipientUserId, mode),
    kv('amount', amountCents + '¢', mode),
    kv('tx', sparkTxHash, mode),
    kv('transferId', confirmation.transferId, mode),
    kv('status', confirmation.status, mode),
  ].join(NL)
}

/** `zappi-cli send external --asset --network --address --amount [--auth <token>]` */
export async function runSendExternal(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { strings } = parseArgs(argv)
  const asset = strings.asset
  const network = strings.network
  const address = strings.address
  const amount = strings.amount
  if (!asset || !network || !address || !amount) {
    throw new Error('Usage: zappi-cli send external --asset <a> --network <n> --address <addr> --amount <cents> [--auth <token>]')
  }
  const amountCents = parseIntFlag(amount, 'amount')
  const client = await resolveZappiClient(env)
  const authorizationToken = strings.auth ?? null
  const idempotencyKey =
    strings['idempotency-key'] ??
    ('cli:sendext:' + asset + ':' + network + ':' + amountCents + ':' + Date.now())

  // Phase 1: request the quote deposit address.
  const first = await client.sendExternal(
    {
      asset,
      networkId: network,
      address,
      amountCents,
      idempotencyKey,
    },
    authorizationToken,
  )

  // Phase 2: if nest needs a signature, sign from the pot and retry.
  let final = first
  if (first.needsSignature && first.depositAddress && first.tokenIdentifier && first.sendAmount) {
    const tokenIdentifier = first.tokenIdentifier
    const mnemonic = loadPotSeed(env)
    const sparkNetwork = resolveSparkNetwork(env)
    const sendAmountUnits = BigInt(first.sendAmount)
    const amountCentsFromUnits = Number(sendAmountUnits / USDB_MICRO_UNITS_PER_CENT)
    const { sparkTxHash } = await sendUsdbFromPot({
      mnemonic,
      accountNumber: 0,
      network: sparkNetwork,
      tokenIdentifier,
      receiverSparkAddress: first.depositAddress,
      amountCents: amountCentsFromUnits,
    })
    final = await client.sendExternal(
      {
        asset,
        networkId: network,
        address,
        amountCents,
        idempotencyKey,
        sparkTxHash,
      },
      authorizationToken,
    )
  }

  const result = {
    ok: true as const,
    command: 'send external' as const,
    asset,
    network,
    address,
    amountCents,
    withdrawId: final.withdrawId ?? null,
    status: final.status,
  }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return 'withdrawId: ' + (final.withdrawId ?? '-') + ' status: ' + final.status
  }
  return [
    successLine('External send submitted', mode),
    kv('asset', asset, mode),
    kv('network', network, mode),
    kv('amount', amountCents + '¢', mode),
    kv('status', final.status, mode),
    ...(final.withdrawId ? [kv('withdrawId', final.withdrawId, mode)] : []),
  ].join(NL)
}

export { withdrawError }
