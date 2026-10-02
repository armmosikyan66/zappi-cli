/**
 * Shared free-pot signing choke point (1-468 / 1-476).
 *
 * Every free-pot money-out path resolves one verified context, checks the
 * recipient Spark network against that context, binds the immutable intent
 * (including an optional caller idempotency salt), and journals the attempt
 * before `sendUsdbFromPot`. Auth-required pots never reach the signer.
 */

import { assertFreeSignerSpendMode, type PotEnv } from './env.js'
import { resolvePotContext, type PotContext, type PotContextSelectors } from './pot-context.js'
import { validateMoneyOutIntent, type MoneyOutIntent, type MoneyOutKind } from './pot-outgate.js'
import {
  beginOperation,
  markSettled,
  recordSubmitted,
  type JournalDeps,
} from './pending-ops.js'
import { inspectSparkAddress } from './spark-address.js'
import {
  sendUsdbFromPot,
  type SendUsdbFromPotInput,
  type SendUsdbFromPotResult,
} from './spark-send.js'

export function assertRecipientOnPotNetwork(
  receiver: string,
  potNetwork: 'MAINNET' | 'REGTEST',
): 'MAINNET' | 'REGTEST' {
  const inspected = inspectSparkAddress(receiver)
  if (!inspected.valid || !inspected.network || inspected.network === 'FOREIGN') {
    throw new Error(
      `Destination is not a valid Spark address for MAINNET/REGTEST: ${receiver}`,
    )
  }
  if (inspected.network !== potNetwork) {
    throw new Error(
      `Recipient Spark network is ${inspected.network} but the pot network is ${potNetwork}. Refusing to sign.`,
    )
  }
  return inspected.network
}

export interface GateAndSignInput {
  env: PotEnv
  selectors?: PotContextSelectors
  kind: MoneyOutKind
  receiver: string
  amountCents: number
  resourceId?: string
  quoteExpiryMs?: number
  /** Caller `--idempotency-key`. Same intent + same salt reconciles; a different salt is a different payment. */
  externalIdempotencyKey?: string
  /** When the quote names an account, it must match the verified context. */
  accountNumber?: number
  /** When the quote names a token id, the signer reads the pot's USDB id and they must match. */
  tokenIdentifier?: string
  journal?: JournalDeps
  resolveContext?: (env: PotEnv) => Promise<PotContext>
  sendUsdb?: (input: SendUsdbFromPotInput) => Promise<SendUsdbFromPotResult>
  readTokenIdentifier?: (
    mnemonic: string,
    accountNumber: number,
    network: 'MAINNET' | 'REGTEST',
  ) => Promise<string>
  now?: () => number
}

export interface GateAndSignResult {
  sparkTxHash: string
  idempotencyKey: string
  reconciled: boolean
  context: PotContext
}

export async function gateAndSignFreePot(input: GateAndSignInput): Promise<GateAndSignResult> {
  assertFreeSignerSpendMode(input.env)
  const context = input.resolveContext
    ? await input.resolveContext(input.env)
    : await resolvePotContext(input.selectors ?? {}, { env: input.env })
  if (context.spendMode !== 'free') {
    throw new Error(
      'Money-out gate is for free pots only. Auth-required pots use request/approve, not the free signer.',
    )
  }
  if (
    input.accountNumber !== undefined &&
    input.accountNumber !== context.accountIndex
  ) {
    throw new Error(
      `Quote account index ${input.accountNumber} does not match the pot account index ${context.accountIndex}. Refusing to sign.`,
    )
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('Money-out amount must be a positive safe integer number of cents. Refusing to sign.')
  }
  const receiverNetwork = assertRecipientOnPotNetwork(input.receiver, context.network)
  const intent: MoneyOutIntent = {
    kind: input.kind,
    potId: context.potId,
    sourceAddress: context.sparkAddress,
    receiver: input.receiver.trim(),
    amountCents: input.amountCents,
    asset: 'USDB',
    network: receiverNetwork,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(input.quoteExpiryMs != null ? { quoteExpiryMs: input.quoteExpiryMs } : {}),
  }
  const { idempotencyKey } = validateMoneyOutIntent(intent, context, {
    ...(input.now ? { now: input.now } : {}),
    ...(input.externalIdempotencyKey
      ? { externalIdempotencyKey: input.externalIdempotencyKey }
      : {}),
  })

  const send = input.sendUsdb ?? sendUsdbFromPot
  const jdeps = input.journal
  const signOnce = async (): Promise<string> => {
    const mnemonic = context.getSeed()
    let tokenIdentifier = input.tokenIdentifier
    if (input.readTokenIdentifier) {
      const fromPot = await input.readTokenIdentifier(
        mnemonic,
        context.accountIndex,
        context.network,
      )
      if (tokenIdentifier && tokenIdentifier !== fromPot) {
        throw new Error(
          'Quote token identifier does not match the pot USDB token. Refusing to sign.',
        )
      }
      tokenIdentifier = fromPot
    }
    if (!tokenIdentifier) {
      throw new Error('Missing USDB token identifier. Refusing to sign.')
    }
    const signed = await send({
      mnemonic,
      accountNumber: context.accountIndex,
      network: context.network,
      tokenIdentifier,
      receiverSparkAddress: input.receiver.trim(),
      amountCents: input.amountCents,
    })
    return signed.sparkTxHash
  }

  if (!jdeps) {
    return {
      sparkTxHash: await signOnce(),
      idempotencyKey,
      reconciled: false,
      context,
    }
  }

  const begin = await beginOperation(intent, idempotencyKey, jdeps)
  if (begin.action === 'sign') {
    const sparkTxHash = await signOnce()
    await recordSubmitted(idempotencyKey, sparkTxHash, jdeps)
    return { sparkTxHash, idempotencyKey, reconciled: false, context }
  }
  if (begin.action === 'reconcile' || begin.action === 'done') {
    const sparkTxHash = begin.op.sparkTxHash ?? ''
    if (!sparkTxHash) {
      throw new Error(
        'Pending money-out has no tx hash to reconcile. Refusing to re-sign.',
      )
    }
    if (begin.action === 'done') {
      return { sparkTxHash, idempotencyKey, reconciled: true, context }
    }
    return { sparkTxHash, idempotencyKey, reconciled: true, context }
  }
  throw new Error(
    `A prior ${input.kind} is in an unknown state (no tx hash recorded). Refusing to sign again. Idempotency key: ${idempotencyKey.slice(0, 16)}…`,
  )
}

export async function markFreePotSettled(
  idempotencyKey: string,
  journal: JournalDeps | undefined,
): Promise<void> {
  if (journal) await markSettled(idempotencyKey, journal)
}
