import type { ZappiClient } from '@zappimoney/zappi-sdk'
import type { PotEnv } from './env.js'

/** Require ZAPPI_POT_ID for Nest pot-scoped send routes (1-315). */
export function requirePotId(env: PotEnv = process.env): string {
  const potId = env.ZAPPI_POT_ID?.trim()
  if (!potId) {
    throw new Error(
      'Set ZAPPI_POT_ID for pot send (Nest /wallet/pots/:id/send/*). Use --pot-id once supported, or export ZAPPI_POT_ID.',
    )
  }
  return potId
}

export interface PotSendResolveTarget {
  destinationSparkAddress: string | null
  recipientCustody?: string
  [key: string]: unknown
}

export interface PotSendExternalPrepare {
  needsSignature?: boolean
  depositAddress?: string | null
  tokenIdentifier?: string | null
  sparkAddress?: string | null
  accountNumber?: number
  sendAmount?: string | null
  withdrawId?: string | null
  status?: string
  [key: string]: unknown
}

export interface PotSendInternalResult {
  ok?: boolean
  transferId?: string
  transactionId?: string
  status?: string
  destinationSparkAddress?: string | null
  [key: string]: unknown
}

function potSendBase(potId: string): string {
  return `wallet/pots/${encodeURIComponent(potId)}/send`
}

/** GET /api/wallet/pots/:id/send/resolve?recipientUserId= */
export async function potResolveSendTarget(
  client: ZappiClient,
  potId: string,
  recipientUserId: string,
): Promise<PotSendResolveTarget> {
  return client.request<PotSendResolveTarget>(
    `${potSendBase(potId)}/resolve?recipientUserId=${encodeURIComponent(recipientUserId)}`,
  )
}

/** POST /api/wallet/pots/:id/send/external (prepare or complete). */
export async function potSendExternal(
  client: ZappiClient,
  potId: string,
  body: {
    asset: string
    networkId: string
    address: string
    amountCents: number
    idempotencyKey: string
    sparkTxHash?: string
  },
  authorizationToken?: string | null,
): Promise<PotSendExternalPrepare> {
  return client.request<PotSendExternalPrepare>(`${potSendBase(potId)}/external`, {
    method: 'POST',
    body: {
      asset: body.asset,
      networkId: body.networkId,
      address: body.address,
      amountCents: body.amountCents,
      idempotencyKey: body.idempotencyKey,
      destinationType: 'external',
      ...(body.sparkTxHash ? { sparkTxHash: body.sparkTxHash } : {}),
    },
    authorizationToken,
  })
}

/** POST /api/wallet/pots/:id/send/internal (prepare or complete). */
export async function potSendInternal(
  client: ZappiClient,
  potId: string,
  body: {
    recipientUserId: string
    amountCents: number
    idempotencyKey: string
    sparkTxHash?: string
    destinationSparkAddress?: string
    memo?: string
  },
  authorizationToken?: string | null,
): Promise<PotSendInternalResult> {
  return client.request<PotSendInternalResult>(`${potSendBase(potId)}/internal`, {
    method: 'POST',
    body: {
      recipientUserId: body.recipientUserId,
      amountCents: body.amountCents,
      idempotencyKey: body.idempotencyKey,
      destinationType: 'internal',
      ...(body.sparkTxHash ? { sparkTxHash: body.sparkTxHash } : {}),
      ...(body.destinationSparkAddress
        ? { destinationSparkAddress: body.destinationSparkAddress }
        : {}),
      ...(body.memo ? { memo: body.memo } : {}),
    },
    authorizationToken,
  })
}
