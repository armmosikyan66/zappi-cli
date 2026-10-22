import { randomUUID } from 'node:crypto'
import { parseArgs, parseIntFlag } from './args.js'
import { writeCliGuest } from './cli-guest.js'
import { cliAccessToken, cliRequest, hasCliActor, type CliHttpDeps } from './cli-http.js'
import { resolvePaywallBase, type PotEnv } from './env.js'
import { redactSecrets } from './paywall-http.js'
import { heading, kv, type OutputMode } from './ui.js'

const NL = '\n'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertKnownFlags(argv: string[], allowed: readonly string[]): void {
  const { strings, booleans } = parseArgs(argv)
  for (const key of [...Object.keys(strings), ...Object.keys(booleans)]) {
    if (key === 'json') continue
    if (!allowed.includes(key)) throw new Error(`Unknown flag --${key}`)
  }
}

function requireActor(env: PotEnv): void {
  if (!hasCliActor(env)) {
    throw new Error('This terminal is not signed in. Run `zappi-cli login`, or `zappi-cli guest` for a free pot.')
  }
}

function plain(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('-') || /[\r\n\0]/.test(trimmed)) {
    throw new Error(`${name} is not a valid value.`)
  }
  return trimmed
}

function dollarFlag(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a dollar amount.`)
  }
  return parsed
}

function potSelector(value: string | undefined): Record<string, string> {
  if (!value) return {}
  const pot = plain(value, '--pot')
  if (UUID.test(pot)) return { potId: pot, pot }
  return { pot }
}

function formatDoor(command: string, body: Record<string, unknown>, mode: OutputMode): string {
  const rest = { ...body }
  delete rest.secret
  const payload = { ok: true, command, ...rest }
  const json = JSON.stringify(payload, null, 2)
  if (mode === 'json') return redactSecrets(json)
  const lines = [heading(command, mode)]
  for (const key of ['status', 'message', 'potId', 'name', 'txid', 'approveUrl', 'url', 'address', 'idempotencyKey']) {
    const value = rest[key]
    if (typeof value === 'string' && value) lines.push(kv(key, value, mode))
  }
  if (Array.isArray(rest.choices)) {
    for (const choice of rest.choices) {
      if (!choice || typeof choice !== 'object') continue
      const label = 'label' in choice && typeof choice.label === 'string' ? choice.label : ''
      const id = 'id' in choice && typeof choice.id === 'string' ? choice.id : ''
      if (label || id) lines.push(kv('choice', label || id, mode))
    }
  }
  if (lines.length === 1) lines.push(redactSecrets(json))
  return redactSecrets(lines.join(NL))
}

async function mintGuest(env: PotEnv, deps: CliHttpDeps): Promise<void> {
  const minted = await cliRequest(env, '/api/cli/guest', { method: 'POST', body: {} }, deps)
  const secret = minted.secret
  if (typeof secret !== 'string' || !secret.startsWith('zcg_')) {
    throw new Error('Zappi did not start a guest pot.')
  }
  writeCliGuest({ version: 1, apiUrl: resolvePaywallBase(env), secret }, env)
}

/** `zappi-cli guest` and `zappi-cli guest claim --pot <id>`. */
export async function runGuestCommand(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  const sub = argv.find((arg) => !arg.startsWith('-'))
  const rest = sub ? argv.filter((arg) => arg !== sub) : argv
  assertKnownFlags(rest, sub === 'claim' ? ['pot'] : [])
  if (sub === 'claim') {
    if (!cliAccessToken(env)) {
      throw new Error('Sign in before claiming a guest pot. Run `zappi-cli login`.')
    }
    const { strings } = parseArgs(rest)
    const potId = plain(strings.pot ?? '', '--pot')
    const body = await cliRequest(env, '/api/cli/guest/claim', { method: 'POST', body: { potId } }, deps)
    return formatDoor('guest claim', body, mode)
  }
  if (sub) {
    throw new Error('Usage: zappi-cli guest [claim --pot <id>]')
  }
  await mintGuest(env, deps)
  return formatDoor('guest', { stored: true }, mode)
}

/** `zappi-cli pots` when the caller is the CLI session, not a project key. */
export async function runDoorPots(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['pot'])
  const { strings } = parseArgs(argv)
  const query = potSelector(strings.pot)
  const body = await cliRequest(env, '/api/cli/pots', { query }, deps)
  return formatDoor('pots', body, mode)
}

export async function runDoorPotCreate(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  assertKnownFlags(argv, [
    'spend-mode',
    'label',
    'skip-name',
    'auth-choice',
    'limits',
    'per-payment',
    'per-day',
  ])
  const { strings, booleans } = parseArgs(argv)
  const spendMode = strings['spend-mode']
  if (spendMode && spendMode !== 'free' && spendMode !== 'auth_required') {
    throw new Error('--spend-mode must be free or auth_required.')
  }
  const authChoice = strings['auth-choice']
  if (authChoice && authChoice !== 'skip') {
    throw new Error('--auth-choice must be skip.')
  }
  const limits = strings.limits
  if (limits && limits !== 'default' && limits !== 'custom') {
    throw new Error('--limits must be default or custom.')
  }
  if (authChoice === 'skip' && !cliAccessToken(env) && !hasCliActor(env)) {
    await mintGuest(env, deps)
  }
  const body: Record<string, unknown> = {}
  if (spendMode) body.spendMode = spendMode
  if (strings.label) body.label = plain(strings.label, '--label')
  if (booleans['skip-name']) body.skipName = true
  if (authChoice === 'skip') body.authChoice = 'skip'
  if (limits) body.limitsChoice = limits
  if (strings['per-payment'] !== undefined) {
    body.perPaymentDollars = dollarFlag(strings['per-payment'], '--per-payment')
  }
  if (strings['per-day'] !== undefined) {
    body.perDayDollars = dollarFlag(strings['per-day'], '--per-day')
  }
  const result = await cliRequest(env, '/api/cli/pots', { method: 'POST', body }, deps)
  return formatDoor('pots create', result, mode)
}

export async function runDoorPotConnect(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['pot', 'default'])
  const { strings, booleans } = parseArgs(argv)
  const selected = potSelector(strings.pot)
  if (!selected.pot && !selected.potId) throw new Error('Missing --pot')
  const body = {
    ...selected,
    ...(booleans.default ? { default: true } : {}),
  }
  const result = await cliRequest(env, '/api/cli/pots/connect', { method: 'POST', body }, deps)
  return formatDoor('pots connect', result, mode)
}

export async function runDoorPotDisconnect(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['pot'])
  const { strings } = parseArgs(argv)
  const body = potSelector(strings.pot)
  if (!body.pot && !body.potId) throw new Error('Missing --pot')
  const result = await cliRequest(env, '/api/cli/pots/disconnect', { method: 'POST', body }, deps)
  return formatDoor('pots disconnect', result, mode)
}

export async function runDoorPotPair(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['pot'])
  const { strings } = parseArgs(argv)
  const result = await cliRequest(
    env,
    '/api/cli/pots/pair',
    { method: 'POST', body: potSelector(strings.pot) },
    deps,
  )
  return formatDoor('pots pair', result, mode)
}

export async function runDoorPotBalance(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['pot'])
  const { strings } = parseArgs(argv)
  const result = await cliRequest(env, '/api/cli/pots/balance', { query: potSelector(strings.pot) }, deps)
  return formatDoor('pots balance', result, mode)
}

export async function runDoorPotChallenge(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['address', 'pot'])
  const { strings } = parseArgs(argv)
  const sparkAddress = plain(strings.address ?? '', '--address')
  const result = await cliRequest(
    env,
    '/api/cli/pots/challenge',
    { method: 'POST', body: { sparkAddress, ...potSelector(strings.pot) } },
    deps,
  )
  return formatDoor('pots challenge', result, mode)
}

/** `zappi-cli pots send` — server-signed send. `assets` and `networks` list the catalog. */
export async function runDoorPotSend(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['amount-cents', 'to', 'asset', 'chain', 'memo', 'pot', 'idempotency-key'])
  const { strings, positionals } = parseArgs(argv)
  const sub = positionals[0]
  if (positionals.length > 1) {
    throw new Error('Usage: zappi-cli pots send [--amount-cents <n> --to <address>] [assets|networks]')
  }
  const pot = potSelector(strings.pot)
  if (sub === 'assets') {
    const result = await cliRequest(env, '/api/cli/send/assets', { query: pot }, deps)
    return formatDoor('pots send assets', result, mode)
  }
  if (sub === 'networks') {
    const query = {
      ...pot,
      ...(strings.asset ? { asset: plain(strings.asset, '--asset') } : {}),
    }
    const result = await cliRequest(env, '/api/cli/send/networks', { query }, deps)
    return formatDoor('pots send networks', result, mode)
  }
  if (sub) throw new Error('Usage: zappi-cli pots send [--amount-cents <n> --to <address>] [assets|networks]')
  const amountCents = parseIntFlag(strings['amount-cents'], 'amount-cents')
  const destinationAddress = plain(strings.to ?? '', '--to')
  const idempotencyKey = strings['idempotency-key']?.trim() || randomUUID()
  const body: Record<string, unknown> = {
    amountCents,
    destinationAddress,
    idempotencyKey,
    ...pot,
  }
  if (strings.asset) body.asset = plain(strings.asset, '--asset')
  if (strings.chain) body.destinationChain = plain(strings.chain, '--chain')
  if (strings.memo) body.memo = plain(strings.memo, '--memo')
  const result = await cliRequest(env, '/api/cli/send', { method: 'POST', body }, deps)
  const echoed =
    typeof result.idempotencyKey === 'string' && result.idempotencyKey
      ? result.idempotencyKey
      : idempotencyKey
  return formatDoor('pots send', { ...result, idempotencyKey: echoed }, mode)
}

/** `zappi-cli deposit rails|assets|networks|address`. */
export async function runDoorDeposit(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: CliHttpDeps = {},
): Promise<string> {
  assertKnownFlags(argv, ['pot', 'asset', 'network'])
  const { strings, positionals } = parseArgs(argv)
  const sub = positionals[0]
  if (positionals.length > 1 || (sub !== 'rails' && sub !== 'assets' && sub !== 'networks' && sub !== 'address')) {
    throw new Error('Usage: zappi-cli deposit <rails|assets|networks|address>')
  }
  requireActor(env)
  const pot = potSelector(strings.pot)
  if (sub === 'rails') {
    const result = await cliRequest(env, '/api/cli/deposit/rails', { query: pot }, deps)
    return formatDoor('deposit rails', result, mode)
  }
  if (sub === 'assets') {
    const result = await cliRequest(env, '/api/cli/deposit/assets', { query: pot }, deps)
    return formatDoor('deposit assets', result, mode)
  }
  if (sub === 'networks') {
    const query = {
      ...pot,
      ...(strings.asset ? { asset: plain(strings.asset, '--asset') } : {}),
    }
    const result = await cliRequest(env, '/api/cli/deposit/networks', { query }, deps)
    return formatDoor('deposit networks', result, mode)
  }
  const body = {
    ...pot,
    ...(strings.asset ? { asset: plain(strings.asset, '--asset') } : {}),
    ...(strings.network ? { network: plain(strings.network, '--network') } : {}),
  }
  const result = await cliRequest(env, '/api/cli/deposit/address', { method: 'POST', body }, deps)
  return formatDoor('deposit address', result, mode)
}

export function usesWalletPotList(argv: string[], env: PotEnv = process.env): boolean {
  if (env.ZAPPI_PROJECT_API_KEY?.trim()) return true
  return argv.some(
    (arg) =>
      arg === '--origin' ||
      arg === '--spend-mode' ||
      arg.startsWith('--origin=') ||
      arg.startsWith('--spend-mode='),
  )
}
