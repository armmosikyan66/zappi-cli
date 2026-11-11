import { randomUUID } from 'node:crypto'
import { parseArgs, parseIntFlag } from './args.js'
import { writeCliGuest } from './cli-guest.js'
import { cliAccessToken, cliRequest, hasCliActor, type CliHttpDeps } from './cli-http.js'
import { resolvePaywallBase, type PotEnv } from './env.js'
import { redactSecrets } from './paywall-http.js'
import { askSendRail, completeDoorSend, type SendRailChoice } from './send-loop.js'
import {
  pullAllowanceWithSpender,
  readSpenderPublicKey,
  type SpenderSpawn,
} from './spender-commands.js'
import { potDepositQrPayload } from './deposit-view.js'
import { renderTerminalQr } from './terminal-qr.js'
import { heading, kv, type OutputMode } from './ui.js'

export interface DoorCommandDeps extends CliHttpDeps {
  spawnSpender?: SpenderSpawn
  chooseSendRail?: (result: Record<string, unknown>) => Promise<SendRailChoice | null>
  sleep?: (ms: number) => Promise<void>
  maxStatusPolls?: number
}

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
  for (const key of [
    'status',
    'message',
    'potId',
    'name',
    'txid',
    'approveUrl',
    'url',
    'address',
    'idempotencyKey',
    'requestId',
    'sparkTxId',
    'next',
  ]) {
    const value = rest[key]
    if (typeof value === 'string' && value) lines.push(kv(key, value, mode))
  }
  if (Array.isArray(rest.choices)) {
    for (const choice of rest.choices) {
      if (!choice || typeof choice !== 'object') continue
      const label = 'label' in choice && typeof choice.label === 'string' ? choice.label : ''
      const id = 'id' in choice && typeof choice.id === 'string' ? choice.id : ''
      const asset = 'asset' in choice && typeof choice.asset === 'string' ? choice.asset : ''
      const network =
        'networkName' in choice && typeof choice.networkName === 'string' ? choice.networkName : ''
      const shown = [network, asset].filter(Boolean).join(' ')
      if (label || id || shown) lines.push(kv('choice', label || shown || id, mode))
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
  const authChoice = strings['auth-choice']
  if (authChoice && authChoice !== 'skip') {
    throw new Error('--auth-choice must be skip.')
  }
  if (authChoice === 'skip' && !cliAccessToken(env) && !hasCliActor(env)) {
    await mintGuest(env, deps)
  }
  const body: Record<string, unknown> = {}
  if (strings.label) body.label = plain(strings.label, '--label')
  if (booleans['skip-name']) body.skipName = true
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
  assertKnownFlags(argv, ['pot'])
  const { strings } = parseArgs(argv)
  const selected = potSelector(strings.pot)
  if (!selected.pot && !selected.potId) throw new Error('Missing --pot')
  const body = selected
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

/** `zappi-cli pots send` — same send as MCP. `assets` and `networks` list the catalog. */
export async function runDoorPotSend(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: DoorCommandDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, [
    'amount-cents',
    'to',
    'asset',
    'chain',
    'memo',
    'pot',
    'idempotency-key',
    'spark-tx-id',
    'no-wait',
  ])
  const { strings, positionals, booleans } = parseArgs(argv)
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
  if (strings['spark-tx-id']) body.sparkTxId = plain(strings['spark-tx-id'], '--spark-tx-id')
  const post = (next: Record<string, unknown>) =>
    cliRequest(env, '/api/cli/send', { method: 'POST', body: next }, deps)
  const result = await completeDoorSend(body, await post(body), {
    post,
    status: (requestId) =>
      cliRequest(env, '/api/cli/payment-status', { query: { requestId, ...pot } }, deps),
    pull: (offer) =>
      pullAllowanceWithSpender(offer, deps.spawnSpender, env as NodeJS.ProcessEnv),
    choose: mode === 'json' ? undefined : (deps.chooseSendRail ?? askSendRail),
    sleep: deps.sleep,
    maxPolls: deps.maxStatusPolls,
    noWait: booleans['no-wait'] === true,
  })
  const echoed =
    typeof result.idempotencyKey === 'string' && result.idempotencyKey
      ? result.idempotencyKey
      : typeof result.requestId === 'string' && result.requestId
        ? result.requestId
        : idempotencyKey
  return formatDoor('pots send', { ...result, idempotencyKey: echoed }, mode)
}

/** `zappi-cli pots send-status <requestId>`. */
export async function runDoorPotSendStatus(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: DoorCommandDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['pot'])
  const { strings, positionals } = parseArgs(argv)
  const requestId = positionals.length === 1 ? plain(positionals[0] ?? '', 'requestId') : ''
  if (!requestId) throw new Error('Usage: zappi-cli pots send-status <requestId> [--pot <id>]')
  const result = await cliRequest(
    env,
    '/api/cli/payment-status',
    { query: { requestId, ...potSelector(strings.pot) } },
    deps,
  )
  return formatDoor('pots send-status', result, mode)
}

/** `zappi-cli pots spender [pubkey]`. Omit the key to read it from the spender. */
export async function runDoorPotSpender(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: DoorCommandDeps = {},
): Promise<string> {
  requireActor(env)
  assertKnownFlags(argv, ['pot'])
  const { strings, positionals } = parseArgs(argv)
  if (positionals.length > 1) throw new Error('Usage: zappi-cli pots spender [pubkey] [--pot <id>]')
  const given = positionals[0] ? plain(positionals[0], 'pubkey') : ''
  const spenderPublicKey =
    given || (await readSpenderPublicKey(deps.spawnSpender, env as NodeJS.ProcessEnv))
  const result = await cliRequest(
    env,
    '/api/cli/pots/spender',
    { method: 'POST', body: { spenderPublicKey, ...potSelector(strings.pot) } },
    deps,
  )
  return formatDoor('pots spender', result, mode)
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
  const text = formatDoor('deposit address', result, mode)
  if (mode !== 'pretty') return text
  const address = typeof result.address === 'string' ? result.address : ''
  if (!address.trim()) return text
  const qr = await renderTerminalQr(
    potDepositQrPayload({
      depositAddress: address,
      sourceAsset: typeof result.asset === 'string' ? result.asset : null,
      sourceChain: typeof result.sourceChain === 'string' ? result.sourceChain : null,
      sourceToken: result.sourceToken,
      qrPayload: typeof result.qrPayload === 'string' ? result.qrPayload : null,
    }),
  )
  return `${text}${NL}${NL}${qr}`
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
