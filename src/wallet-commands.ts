import { resolveZappiClient } from './client.js'
import { tokenBalanceEntries } from './spark-send.js'
import { requirePotId, type PotEnv } from './env.js'
import {
  errorLine,
  heading,
  infoLine,
  kv,
  successLine,
  type OutputMode,
} from './ui.js'

const NL = '\n'

/** `zappi-cli balance [--pot <id>]` */
export async function runBalance(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const potFlagIndex = argv.indexOf('--pot')
  const potFlag = potFlagIndex >= 0 ? argv[potFlagIndex + 1] : undefined
  const client = await resolveZappiClient(env)

  if (potFlag || env.ZAPPI_POT_ID) {
    const potId = (potFlag?.trim() || requirePotId(env)).trim()
    const bal = await client.getPotBalance(potId)
    const result = {
      ok: true as const,
      command: 'balance' as const,
      scope: 'pot' as const,
      potId,
      balanceUsdCents: bal.balanceUsdCents,
      pendingUsdCents: bal.pendingUsdCents,
    }
    if (mode === 'json') return JSON.stringify(result, null, 2)
    if (mode === 'plain') {
      return [
        `pot ${potId}`,
        `balance: ${bal.balanceUsdCents} cents`,
        `pending: ${bal.pendingUsdCents} cents`,
      ].join(NL)
    }
    return [
      heading('Pot balance', mode),
      kv('pot', potId, mode),
      kv('balance', `${bal.balanceUsdCents}¢`, mode),
      kv('pending', `${bal.pendingUsdCents}¢`, mode),
    ].join(NL)
  }

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

/** Shared error formatter for wallet commands. */
export function formatWalletError(message: string, mode: OutputMode): string {
  if (mode === 'json') return JSON.stringify({ ok: false, error: message }, null, 2)
  if (mode === 'plain') return message
  return errorLine(message, mode)
}
