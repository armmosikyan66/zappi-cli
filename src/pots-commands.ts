import { resolveZappiClient } from './client.js'
import { parseArgs, parseIntFlag } from './args.js'
import { type PotEnv } from './env.js'
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

function jsonOut(result: unknown): string {
  return JSON.stringify(result, null, 2)
}

function potError(message: string, mode: OutputMode): string {
  if (mode === 'json') return jsonOut({ ok: false, error: message })
  if (mode === 'plain') return message
  return errorLine(message, mode)
}

/** `zappi-cli pots [--origin user|agent|unknown] [--spend-mode free|auth_required|unknown]` */
export async function runPotsList(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { strings } = parseArgs(argv)
  const client = await resolveZappiClient(env)
  const query: { origin?: 'user' | 'agent' | 'unknown'; spendMode?: 'auth_required' | 'free' | 'unknown' } = {}
  if (strings.origin) query.origin = strings.origin as 'user' | 'agent' | 'unknown'
  if (strings['spend-mode']) query.spendMode = strings['spend-mode'] as 'auth_required' | 'free' | 'unknown'
  const pots = await client.listPots(query)
  const result = { ok: true as const, command: 'pots' as const, pots }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    if (pots.length === 0) return 'No pots.'
    return pots
      .map(
        (p) =>
          `${p.id} ${p.sparkAddress} ${p.spendMode} ${p.status} connected=${p.connected}`,
      )
      .join(NL)
  }
  if (pots.length === 0) return infoLine('No pots.', mode)
  const lines = [heading('Pots', mode)]
  for (const p of pots) {
    lines.push(
      `${successLine(p.label ?? p.id, mode)} ${kv('address', p.sparkAddress, mode)} ${kv('spend', p.spendMode, mode)} ${kv('status', p.status, mode)}`,
    )
  }
  return lines.join(NL)
}

/** `zappi-cli pots register <sparkAddress> [--label L] [--spend-mode free|auth_required]` */
export async function runPotRegister(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals, strings } = parseArgs(argv)
  const sparkAddress = positionals[0]
  if (!sparkAddress) throw new Error('Usage: zappi-cli pots register <sparkAddress> [--label L] [--spend-mode free|auth_required]')
  const client = await resolveZappiClient(env)
  const body: { sparkAddress: string; label?: string; spendMode?: 'auth_required' | 'free' } = {
    sparkAddress,
  }
  if (strings.label) body.label = strings.label
  if (strings['spend-mode']) body.spendMode = strings['spend-mode'] as 'auth_required' | 'free'
  const pot = await client.createPot(body)
  const result = { ok: true as const, command: 'pots register' as const, pot }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return [`id: ${pot.id}`, `address: ${pot.sparkAddress}`, `spend: ${pot.spendMode}`].join(NL)
  }
  return [
    heading('Pot registered', mode),
    kv('id', pot.id, mode),
    kv('address', pot.sparkAddress, mode),
    kv('spend', pot.spendMode, mode),
  ].join(NL)
}

/** `zappi-cli pots deposit-address <id>` */
export async function runPotDepositAddress(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals, strings } = parseArgs(argv)
  const id = positionals[0]
  if (!id) throw new Error('Usage: zappi-cli pots deposit-address <id> [--source-chain base]')
  const client = await resolveZappiClient(env)
  const body: Record<string, unknown> = {}
  if (strings['source-chain']) body.sourceChain = strings['source-chain']
  const res = await client.createPotDepositAddress(id, body)
  const result = { ok: true as const, command: 'pots deposit-address' as const, ...res }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return [`pot: ${res.potId}`, `deposit: ${res.depositAddress}`].join(NL)
  }
  return [
    heading('Pot deposit address', mode),
    kv('pot', res.potId, mode),
    kv('deposit', res.depositAddress, mode),
  ].join(NL)
}

/** `zappi-cli pots grants <id> [--create] [--revoke <grantId>] [--scopes read,deposit]` */
export async function runPotGrants(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals, strings, booleans } = parseArgs(argv)
  const id = positionals[0]
  if (!id) throw new Error('Usage: zappi-cli pots grants <id> [--create] [--revoke <grantId>] [--scopes read,deposit]')
  const client = await resolveZappiClient(env)

  if (booleans.create) {
    const scopes = strings.scopes ? strings.scopes.split(',').map((s) => s.trim()) : ['read']
    const grant = await client.createPotGrant(id, { scopes })
    const result = { ok: true as const, command: 'pots grants' as const, action: 'create' as const, grant }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return `grant: ${grant.id} scopes=${grant.scopes.join(',')}`
    return [
      heading('Pot grant created', mode),
      kv('grant', grant.id, mode),
      kv('scopes', grant.scopes.join(','), mode),
    ].join(NL)
  }

  if (strings.revoke) {
    await client.revokePotGrant(id, strings.revoke)
    const result = { ok: true as const, command: 'pots grants' as const, action: 'revoke' as const, grantId: strings.revoke }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return `revoked: ${strings.revoke}`
    return [
      successLine('Pot grant revoked', mode),
      kv('grant', strings.revoke, mode),
      warnLine('Disconnect cannot stop on-chain spend. Empty pot is the cap.', mode),
    ].join(NL)
  }

  const grants = await client.listPotGrants(id)
  const result = { ok: true as const, command: 'pots grants' as const, action: 'list' as const, grants }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    if (grants.length === 0) return 'No grants.'
    return grants.map((g) => `${g.id} scopes=${g.scopes.join(',')}`).join(NL)
  }
  if (grants.length === 0) return infoLine('No grants.', mode)
  const lines = [heading('Pot grants', mode)]
  for (const g of grants) {
    lines.push(`${successLine(g.id, mode)} ${kv('scopes', g.scopes.join(','), mode)}`)
  }
  return lines.join(NL)
}

/** `zappi-cli pots spend-gate <id> [--action withdraw|internal_send|sweep]` */
export async function runPotSpendGate(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals, strings } = parseArgs(argv)
  const id = positionals[0]
  if (!id) throw new Error('Usage: zappi-cli pots spend-gate <id> [--action withdraw|internal_send|sweep]')
  const client = await resolveZappiClient(env)
  const action = strings.action as 'withdraw' | 'internal_send' | 'sweep' | undefined
  const gate = await client.getPotSpendGate(id, action)
  const result = { ok: true as const, command: 'pots spend-gate' as const, ...gate }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    return `pot ${gate.potId} gated=${gate.gated} leash=${gate.leash}`
  }
  return [
    heading('Pot spend gate', mode),
    kv('pot', gate.potId, mode),
    kv('spend', gate.spendMode, mode),
    kv('gated', String(gate.gated), mode),
    kv('leash', gate.leash, mode),
  ].join(NL)
}

/** `zappi-cli pots spend-approvals <id> [--create --action withdraw --amount 100 --destination 0x] [--approve <id> | --reject <id>] [--auth <token>]` */
export async function runPotSpendApprovals(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
): Promise<string> {
  const { positionals, strings, booleans } = parseArgs(argv)
  const id = positionals[0]
  if (!id) {
    throw new Error(
      'Usage: zappi-cli pots spend-approvals <id> [--create --action withdraw --amount 100 --destination 0x] [--approve <id> | --reject <id>] [--auth <token>]',
    )
  }
  const client = await resolveZappiClient(env)
  const auth = strings.auth ?? null

  if (booleans.create) {
    if (!strings.action) throw new Error('--create requires --action withdraw|internal_send|sweep')
    const body: { action: 'withdraw' | 'internal_send' | 'sweep'; amountCents?: number; destination?: string } = {
      action: strings.action as 'withdraw' | 'internal_send' | 'sweep',
    }
    if (strings.amount) body.amountCents = parseIntFlag(strings.amount, 'amount')
    if (strings.destination) body.destination = strings.destination
    const approval = await client.createPotSpendApproval(id, body)
    const result = { ok: true as const, command: 'pots spend-approvals' as const, action: 'create' as const, approval }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return `approval: ${approval.id} status=${approval.status}`
    return [
      heading('Spend approval queued', mode),
      kv('id', approval.id, mode),
      kv('action', approval.action, mode),
      kv('status', approval.status, mode),
    ].join(NL)
  }

  if (strings.approve) {
    const approval = await client.approvePotSpend(id, strings.approve, auth)
    const result = { ok: true as const, command: 'pots spend-approvals' as const, action: 'approve' as const, approval }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return `approved: ${approval.id} status=${approval.status}`
    return [
      successLine('Spend approval approved', mode),
      kv('id', approval.id, mode),
      kv('status', approval.status, mode),
    ].join(NL)
  }

  if (strings.reject) {
    const approval = await client.rejectPotSpend(id, strings.reject)
    const result = { ok: true as const, command: 'pots spend-approvals' as const, action: 'reject' as const, approval }
    if (mode === 'json') return jsonOut(result)
    if (mode === 'plain') return `rejected: ${approval.id} status=${approval.status}`
    return [
      successLine('Spend approval rejected', mode),
      kv('id', approval.id, mode),
      kv('status', approval.status, mode),
    ].join(NL)
  }

  const approvals = await client.listPotSpendApprovals(id)
  const result = { ok: true as const, command: 'pots spend-approvals' as const, action: 'list' as const, approvals }
  if (mode === 'json') return jsonOut(result)
  if (mode === 'plain') {
    if (approvals.length === 0) return 'No spend approvals.'
    return approvals.map((a) => `${a.id} ${a.action} ${a.status}`).join(NL)
  }
  if (approvals.length === 0) return infoLine('No spend approvals.', mode)
  const lines = [heading('Pot spend approvals', mode)]
  for (const a of approvals) {
    lines.push(`${successLine(a.id, mode)} ${kv('action', a.action, mode)} ${kv('status', a.status, mode)}`)
  }
  return lines.join(NL)
}

/** Shared error wrapper for pots commands. */
export { potError as potsError }
