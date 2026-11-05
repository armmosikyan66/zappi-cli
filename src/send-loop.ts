import { createInterface } from 'node:readline/promises'
import { SpenderPullUncertain } from './spender-commands.js'

const PENDING_STATUS = new Set([
  'authorization_required',
  'pending',
  'approved',
  'issued',
  'reserved',
  'unsigned',
])

const POLL_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000]

export interface SendRailChoice {
  asset: string
  destinationChain: string
}

export interface DoorSendLoopOptions {
  post: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
  status: (requestId: string) => Promise<Record<string, unknown>>
  pull: (offer: Record<string, unknown>) => Promise<string>
  /** Pretty mode only. Returning null prints the choices and stops. */
  choose?: (result: Record<string, unknown>) => Promise<SendRailChoice | null>
  sleep?: (ms: number) => Promise<void>
  maxPolls?: number
  noWait?: boolean
}

/**
 * Finish one `pots send` the way the MCP send tool does.
 * The spender binary runs only for `allowance_pull`. There is no signer step.
 */
export async function completeDoorSend(
  body: Record<string, unknown>,
  first: Record<string, unknown>,
  options: DoorSendLoopOptions,
): Promise<Record<string, unknown>> {
  let currentBody = body
  let result = first
  let pulls = 0
  let choices = 0
  for (;;) {
    assertNotAllowanceRefusal(result)
    if (result.status === 'need_choice') {
      if (!options.choose || choices >= 3) return result
      choices += 1
      const picked = await options.choose(result)
      if (!picked) return result
      currentBody = {
        ...currentBody,
        asset: picked.asset,
        destinationChain: picked.destinationChain,
      }
      result = await options.post(currentBody)
      continue
    }
    if (result.status === 'allowance_pull') {
      if (pulls > 0) {
        throw new SpenderPullUncertain(
          typeof result.next === 'string' ? result.next : undefined,
        )
      }
      pulls += 1
      const txId = await options.pull(result)
      const requestId = text(result.requestId)
      if (!requestId) throw new SpenderPullUncertain()
      currentBody = {
        ...currentBody,
        idempotencyKey: requestId,
        sparkTxId: txId,
      }
      result = await options.post(currentBody)
      continue
    }
    if (!options.noWait && shouldPoll(result)) {
      return pollPayment(result, options)
    }
    return result
  }
}

function assertNotAllowanceRefusal(result: Record<string, unknown>): void {
  if (result.status !== 'allowance_required') return
  const message = text(result.message) || 'A signed allowance is required before this pot can send.'
  throw new Error(message)
}

function shouldPoll(result: Record<string, unknown>): boolean {
  if (text(result.txid)) return false
  if (result.ok === false) return false
  if (result.status === 'settled' || result.status === 'need_browser') return false
  return Boolean(text(result.approveUrl) || result.status === 'authorization_required')
}

async function pollPayment(
  initial: Record<string, unknown>,
  options: DoorSendLoopOptions,
): Promise<Record<string, unknown>> {
  const requestId = requestIdOf(initial)
  if (!requestId) return initial
  const sleep = options.sleep ?? delay
  const maxPolls = options.maxPolls ?? POLL_DELAYS_MS.length
  let latest = initial
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await sleep(POLL_DELAYS_MS[attempt] ?? POLL_DELAYS_MS[POLL_DELAYS_MS.length - 1] ?? 8000)
    try {
      latest = await options.status(requestId)
    } catch {
      return initial
    }
    if (isTerminal(latest)) return latest
  }
  return { ...initial, ...latest, requestId }
}

function isTerminal(result: Record<string, unknown>): boolean {
  if (text(result.txid)) return true
  const status = text(result.status)
  if (!status) return false
  return !PENDING_STATUS.has(status)
}

export function requestIdOf(result: Record<string, unknown>): string | null {
  const direct = text(result.requestId)
  if (direct) return direct
  const approveUrl = text(result.approveUrl)
  if (!approveUrl) return null
  try {
    return new URL(approveUrl).searchParams.get('spend')?.trim() || null
  } catch {
    return null
  }
}

/** Numbered prompt on a terminal. A pipe prints the choices and stops. */
export async function askSendRail(
  result: Record<string, unknown>,
): Promise<SendRailChoice | null> {
  if (!process.stdin.isTTY) return null
  const choices = listedRails(result)
  if (choices.length === 0) return null
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const message = text(result.message) || 'Choose the asset and network.'
    process.stderr.write(`${message}\n`)
    for (let index = 0; index < choices.length; index += 1) {
      const choice = choices[index]
      if (!choice) continue
      process.stderr.write(`${index + 1}. ${choice.destinationChain} ${choice.asset}\n`)
    }
    const answer = (await prompt.question('Choice: ')).trim()
    const picked = choices[Number(answer) - 1]
    if (!picked) throw new Error('Pick one of the listed assets and networks.')
    return picked
  } finally {
    prompt.close()
  }
}

export function listedRails(result: Record<string, unknown>): SendRailChoice[] {
  if (!Array.isArray(result.choices)) return []
  const rails: SendRailChoice[] = []
  for (const choice of result.choices) {
    if (!choice || typeof choice !== 'object') continue
    const record = choice as Record<string, unknown>
    const asset = text(record.asset)
    const destinationChain = text(record.networkId) || text(record.destinationChain)
    if (asset && destinationChain) rails.push({ asset, destinationChain })
  }
  return rails
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
