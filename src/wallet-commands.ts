import { resolveZappiClient } from './client.js'
import { tokenBalanceEntries } from './spark-send.js'
import {
  hostHasPotClientToken,
  requirePotId,
  resolvePaywallBase,
  resolvePotClientToken,
  resolvePotSpendMode,
  type PotEnv,
} from './env.js'
import { fetchPaywall, redactSecrets } from './paywall-http.js'
import {
  errorLine,
  heading,
  infoLine,
  kv,
  successLine,
  type OutputMode,
} from './ui.js'

const NL = '\n'

export interface BalanceDeps {
  fetch?: typeof fetch
  log?: (message: string) => void
}

/**
 * Prefer pot-client auth for agent pot balance so a mismatched human login
 * cannot trap attached agents. Session getPotBalance stays for free / owner
 * wallets without an attach token.
 */
export function shouldUsePotClientBalance(env: PotEnv): boolean {
  if (resolvePotSpendMode(env) === 'auth_required') return true
  return hostHasPotClientToken(env)
}

/** `zappi-cli balance [--pot <id>]` */
export async function runBalance(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: BalanceDeps = {},
): Promise<string> {
  const potFlagIndex = argv.indexOf('--pot')
  const potFlag = potFlagIndex >= 0 ? argv[potFlagIndex + 1] : undefined
  const wantsPot = Boolean(potFlag?.trim() || env.ZAPPI_POT_ID?.trim())

  if (wantsPot) {
    const potId = (potFlag?.trim() || requirePotId(env)).trim()
    if (shouldUsePotClientBalance(env)) {
      const bal = await fetchPotClientBalance(potId, env, deps)
      return formatPotBalanceResult(bal, potId, mode, 'pot_client')
    }
    const client = await resolveZappiClient(env)
    const bal = await client.getPotBalance(potId)
    return formatPotBalanceResult(
      {
        balanceUsdCents: bal.balanceUsdCents,
        pendingUsdCents: bal.pendingUsdCents,
      },
      potId,
      mode,
      'session',
    )
  }

  const client = await resolveZappiClient(env)
  const bal = await client.getWalletBalance()
  // USDB balance is in the token's smallest unit (micro-USDB). Find the USDB
  // token entry; fall back to the first token balance when unnamed.
  const tokenEntries = tokenBalanceEntries(bal.tokenBalances)
  const usdbEntry =
    tokenEntries.find(([id]) => id.startsWith('btkn')) ?? tokenEntries[0]
  const usdbOwned =
    (usdbEntry?.[1] as { ownedBalance?: string } | undefined)?.ownedBalance ??
    '0'
  const result = {
    ok: true as const,
    command: 'balance' as const,
    scope: 'wallet' as const,
    walletAddress: bal.walletAddress,
    usdbTokenId: usdbEntry?.[0] ?? null,
    usdbOwned,
    pendingTransfers: (bal.pendingTransfers ?? []).length,
    recentTransfers: (bal.recentTransfers ?? []).length,
    readonlyReady: bal.readonlyReady,
    tokenBalances: bal.tokenBalances,
  }
  if (mode === 'json') return JSON.stringify(result, null, 2)
  if (mode === 'plain') {
    return [
      `wallet: ${bal.walletAddress}`,
      `usdb: ${usdbOwned}`,
      `pending: ${(bal.pendingTransfers ?? []).length}`,
    ].join(NL)
  }
  return [
    heading('Wallet balance', mode),
    kv('wallet', bal.walletAddress, mode),
    kv('usdb', usdbOwned, mode),
    kv('pending', String((bal.pendingTransfers ?? []).length), mode),
  ].join(NL)
}

/** `zappi-cli transactions [<id>]` */
export async function runTransactions(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const positional = argv.find((a) => !a.startsWith('-'))
  const client = await resolveZappiClient(env)

  if (positional) {
    const tx = await client.getTransaction(positional)
    const result = {
      ok: true as const,
      command: 'transactions' as const,
      transaction: tx,
    }
    if (mode === 'json') return JSON.stringify(result, null, 2)
    if (mode === 'plain') {
      return [
        `id: ${tx.id}`,
        `type: ${tx.type}`,
        `status: ${tx.status}`,
        `amount: ${tx.amountCents} cents`,
      ].join(NL)
    }
    return [
      heading('Transaction', mode),
      kv('id', tx.id, mode),
      kv('type', tx.type, mode),
      kv('status', tx.status, mode),
      kv('amount', `${tx.amountCents}¢`, mode),
    ].join(NL)
  }

  const txs = await client.listTransactions()
  const result = {
    ok: true as const,
    command: 'transactions' as const,
    transactions: txs,
  }
  if (mode === 'json') return JSON.stringify(result, null, 2)
  if (mode === 'plain') {
    if (txs.length === 0) return 'No transactions.'
    return txs
      .map(
        (t) =>
          `${t.id} ${t.type} ${t.status} ${t.amountCents}¢ ${t.occurredAt}`,
      )
      .join(NL)
  }
  if (txs.length === 0) return infoLine('No transactions.', mode)
  const lines = [heading('Transactions', mode)]
  for (const t of txs) {
    lines.push(
      `${successLine(t.type, mode)} ${kv('id', t.id, mode)} ${kv(
        'amount',
        `${t.amountCents}¢`,
        mode,
      )} ${kv('status', t.status, mode)}`,
    )
  }
  return lines.join(NL)
}


export interface PotClientBalance {
  potId?: string
  balanceUsdCents: number | null
  pendingUsdCents: number | null
  availability?: string
  cachedAt?: number
  stale?: boolean
  syncing?: boolean
  verifiedAt?: number
  lastErrorCode?: string
}

/**
 * GET pot balance with the attach token only — no user login.
 * Nest zappi-nest#84 tip 5dc4f07:
 * `GET /api/wallet/self-custody/pots/:potId/balance` + `x-zappi-pot-client`
 * Allowlist with spend-requests POST+GET.
 */
export async function fetchPotClientBalance(
  potId: string,
  env: PotEnv = process.env,
  deps: BalanceDeps = {},
): Promise<PotClientBalance> {
  const clientToken = resolvePotClientToken(env)
  const response = await fetchPaywall(
    `/api/wallet/self-custody/pots/${encodeURIComponent(potId)}/balance`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-zappi-pot-client': clientToken,
        'User-Agent': 'zappi-cli',
      },
    },
    {
      baseUrl: resolvePaywallBase(env),
      fetch: deps.fetch,
      log: deps.log
        ? (message) => deps.log?.(redactSecrets(message))
        : undefined,
    },
  )

  if (response.status !== 200) {
    throw new Error(
      redactSecrets(
        `Pot balance failed (${response.status}): ${messageFromBalanceBody(response.body, 'unknown error')}`,
      ),
    )
  }

  const record =
    response.body && typeof response.body === 'object'
      ? (response.body as Record<string, unknown>)
      : {}

  const out: PotClientBalance = {
    balanceUsdCents: asNullableNumber(record.balanceUsdCents),
    pendingUsdCents: asNullableNumber(record.pendingUsdCents),
  }
  if (typeof record.potId === 'string' && record.potId.trim()) {
    out.potId = record.potId.trim()
  }
  if (typeof record.availability === 'string') {
    out.availability = record.availability
  }
  const cachedAt = asNullableNumber(record.cachedAt)
  if (cachedAt != null) out.cachedAt = cachedAt
  if (typeof record.stale === 'boolean') out.stale = record.stale
  if (typeof record.syncing === 'boolean') out.syncing = record.syncing
  const verifiedAt = asNullableNumber(record.verifiedAt)
  if (verifiedAt != null) out.verifiedAt = verifiedAt
  if (typeof record.lastErrorCode === 'string' && record.lastErrorCode.trim()) {
    out.lastErrorCode = record.lastErrorCode.trim()
  }
  return out
}

function formatPotBalanceResult(
  bal: PotClientBalance,
  potId: string,
  mode: OutputMode,
  auth: 'pot_client' | 'session',
): string {
  const balanceUsdCents = bal.balanceUsdCents ?? 0
  const pendingUsdCents = bal.pendingUsdCents ?? 0
  const resolvedPotId = bal.potId?.trim() || potId
  const result: Record<string, unknown> = {
    ok: true,
    command: 'balance',
    scope: 'pot',
    potId: resolvedPotId,
    balanceUsdCents,
    pendingUsdCents,
    auth,
  }
  if (bal.availability) result.availability = bal.availability
  if (bal.cachedAt != null) result.cachedAt = bal.cachedAt
  if (bal.stale != null) result.stale = bal.stale
  if (bal.syncing != null) result.syncing = bal.syncing
  if (bal.verifiedAt != null) result.verifiedAt = bal.verifiedAt
  if (bal.lastErrorCode) result.lastErrorCode = bal.lastErrorCode

  if (mode === 'json') return JSON.stringify(result, null, 2)
  if (mode === 'plain') {
    return [
      `pot ${resolvedPotId}`,
      `balance: ${balanceUsdCents} cents`,
      `pending: ${pendingUsdCents} cents`,
    ].join(NL)
  }
  return [
    heading('Pot balance', mode),
    kv('pot', resolvedPotId, mode),
    kv('balance', `${balanceUsdCents}¢`, mode),
    kv('pending', `${pendingUsdCents}¢`, mode),
  ].join(NL)
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function messageFromBalanceBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    return String((body as { message: unknown }).message)
  }
  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as { error: unknown }).error)
  }
  return fallback
}

/** Shared error formatter for wallet commands. */
export function formatWalletError(message: string, mode: OutputMode): string {
  if (mode === 'json') return JSON.stringify({ ok: false, error: message }, null, 2)
  if (mode === 'plain') return message
  return errorLine(message, mode)
}
