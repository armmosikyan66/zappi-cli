/**
 * Deterministic pre-sign gate for every free-pot money-out path — Linear
 * 1-456 stage 5 / 1-461. Reuses the 1-316 transfer-must-match-402 discipline and
 * binds the operation's idempotency key to an immutable intent derived from the
 * verified {@link PotContext}, so a replay reconciles instead of issuing a
 * second payment.
 *
 * The gate is pure: it never touches the seed (only the context's public
 * identity) and performs no I/O. Durable pending-operation journaling and caps
 * are layered on top in a follow-up slice; this module establishes the
 * deterministic checks both paths share.
 *
 * Free pots only. Auth-required spend tickets are unchanged (Nest-side).
 */

import { createHash } from 'node:crypto'
import type { PotContext } from './pot-context.js'

export type MoneyOutKind = 'pay' | 'send'
export type MoneyOutAsset = 'USDB'
export type MoneyOutNetwork = 'MAINNET' | 'REGTEST'

export interface MoneyOutIntent {
  kind: MoneyOutKind
  potId: string
  /** The pot's own Spark address (the signing identity), from the context. */
  sourceAddress: string
  /** Exact recipient Spark address. */
  receiver: string
  /** Positive integer number of cents. */
  amountCents: number
  asset: MoneyOutAsset
  network: MoneyOutNetwork
  /** pay only: the paywall resource id (binds resource/challenge). */
  resourceId?: string
  /** send only: optional quote expiry (ms epoch) for routed sends. */
  quoteExpiryMs?: number
}

export interface ValidatedMoneyOut {
  intent: MoneyOutIntent
  /** Deterministic key bound to the immutable intent (+ optional external salt). */
  idempotencyKey: string
}

/**
 * Deterministic canonical string of the immutable fields that must match the
 * signed transaction. Sorted keys so reordering is not a different intent.
 */
export function canonicalIntent(intent: MoneyOutIntent): string {
  const sorted = {
    amountCents: intent.amountCents,
    asset: intent.asset,
    kind: intent.kind,
    network: intent.network,
    potId: intent.potId,
    quoteExpiryMs: intent.quoteExpiryMs ?? 0,
    receiver: intent.receiver.trim(),
    resourceId: intent.resourceId?.trim() ?? '',
    sourceAddress: intent.sourceAddress.trim(),
  }
  return JSON.stringify(sorted)
}

/** Stable SHA-256 of the canonical intent. */
export function intentHash(intent: MoneyOutIntent): string {
  return createHash('sha256').update(canonicalIntent(intent)).digest('hex')
}

/**
 * Derive the idempotency key bound to the immutable intent. An external salt
 * (`--idempotency-key`) is mixed in so a caller can disambiguate retries of the
 * same intent without changing the bound identity. The key is deterministic:
 * the same intent always yields the same key, so a replay reconciles instead
 * of issuing a second payment.
 */
export function deriveIdempotencyKey(
  intent: MoneyOutIntent,
  externalSalt?: string,
): string {
  const salt = externalSalt?.trim() || ''
  return createHash('sha256')
    .update(salt + '\u0000' + canonicalIntent(intent))
    .digest('hex')
}

export interface ValidateMoneyOutOptions {
  now?: () => number
  /** Optional external idempotency salt (`--idempotency-key`). */
  externalIdempotencyKey?: string
  /**
   * Journaled routes look up an existing tx hash before rejecting an expired
   * quote. The sign path checks expiry itself, immediately before broadcast.
   */
  skipQuoteExpiry?: boolean
}

/**
 * Deterministic pre-sign checks (1-316 reuse + 1-461). Rejects missing,
 * contradictory, expired or unsupported data BEFORE signing. Binds the
 * immutable intent to the verified source-pot context.
 */
export function validateMoneyOutIntent(
  intent: MoneyOutIntent,
  context: PotContext,
  options: ValidateMoneyOutOptions = {},
): ValidatedMoneyOut {
  const now = (options.now ?? Date.now)()

  // Source-pot binding: the intent's pot id / network / source address must
  // match the verified context. This is the "source pot must match" gate —
  // an intent built from a different pot or a stale env value fails closed.
  if (intent.potId !== context.potId) {
    throw new Error(
      `Money-out intent pot ${intent.potId} does not match the resolved pot ${context.potId}. Refusing to sign.`,
    )
  }
  if (intent.network !== context.network) {
    throw new Error(
      `Money-out intent network ${intent.network} does not match the pot network ${context.network}. Refusing to sign.`,
    )
  }
  if (intent.sourceAddress.trim() !== context.sparkAddress.trim()) {
    throw new Error(
      `Money-out intent source address does not match the pot identity ${context.sparkAddress}. Refusing to sign.`,
    )
  }
  if (context.spendMode !== 'free') {
    throw new Error(
      'Money-out gate is for free pots only. Auth-required pots use request/approve, not the free signer.',
    )
  }

  // Receiver must be present.
  const receiver = intent.receiver.trim()
  if (!receiver) {
    throw new Error('Money-out intent missing recipient. Refusing to sign.')
  }

  // Integer amount, positive.
  if (!Number.isInteger(intent.amountCents) || intent.amountCents <= 0) {
    throw new Error(
      'Money-out amount must be a positive integer number of cents. Refusing to sign.',
    )
  }

  // Canonical asset identity — this CLI signs USDB only.
  if (intent.asset !== 'USDB') {
    throw new Error(
      `Money-out asset ${intent.asset} is unsupported; this CLI can only sign USDB. Refusing to sign.`,
    )
  }

  // pay binds the resource; send must not carry one.
  if (intent.kind === 'pay') {
    if (!intent.resourceId?.trim()) {
      throw new Error('Pay intent missing resource id. Refusing to sign.')
    }
  } else {
    if (intent.resourceId) {
      throw new Error('Send intent must not carry a resource id. Refusing to sign.')
    }
  }

  // Quote expiry (routed sends). Journaled retries skip this so a submitted
  // hash can be reconciled after the quote clock runs out.
  if (!options.skipQuoteExpiry && intent.quoteExpiryMs != null && intent.quoteExpiryMs <= now) {
    throw new Error('Quote has expired. Re-fetch a quote before signing.')
  }

  const idempotencyKey = deriveIdempotencyKey(intent, options.externalIdempotencyKey)
  return { intent, idempotencyKey }
}
