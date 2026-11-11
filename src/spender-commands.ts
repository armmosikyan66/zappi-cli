import { spawn } from 'node:child_process'
import { sanitizedChildEnv } from './child-env.js'

/**
 * Path to the allowance spender. This variable wins, then
 * `zappi-allowance-spender` on PATH. The CLI never reads the spender seed.
 */
export const SPENDER_BIN_ENV = 'ZAPPI_ALLOWANCE_SPENDER_BIN'

const DEFAULT_SPENDER_BIN = 'zappi-allowance-spender'

export const SPENDER_INSTALL_GUIDANCE =
  'zappi-allowance-spender was not found. Install it from /spender/install (Windows: /spender/windows), then run zappi-cli pots spender. Set ZAPPI_ALLOWANCE_SPENDER_BIN when it is not on PATH.'

export interface SpenderRunResult {
  code: number
  stdout: string
  stderr: string
}

export type SpenderSpawn = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<SpenderRunResult>

export class SpenderNotFoundError extends Error {
  readonly exitCode = 1

  constructor() {
    super(SPENDER_INSTALL_GUIDANCE)
    this.name = 'SpenderNotFoundError'
  }
}

/** Child already finished. The message is the one uncertain report. */
export class SpenderPullUncertain extends Error {
  readonly exitCode: number

  constructor(detail?: string, code = 1) {
    const reason = detail?.trim()
    super(
      reason
        ? `The pull result is uncertain. ${reason} Do not send again.`
        : 'The pull result is uncertain. Reported once. Do not send again.',
    )
    this.name = 'SpenderPullUncertain'
    this.exitCode = code > 0 ? code : 1
  }
}

export function forwardedSpenderExitCode(error: unknown): number | undefined {
  if (error instanceof SpenderNotFoundError || error instanceof SpenderPullUncertain) {
    return error.exitCode
  }
  return undefined
}

export function resolveSpenderBinary(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[SPENDER_BIN_ENV]
  if (configured !== undefined && configured.length > 0) return configured
  return DEFAULT_SPENDER_BIN
}

export function pullArgs(offer: Record<string, unknown>): string[] {
  return [
    'pull',
    '--allowance-id',
    requiredHex(offer.allowanceId, 'allowance id'),
    '--owner-public-key',
    requiredHex(offer.ownerPublicKey, 'owner public key'),
    '--token-identifier',
    requiredHex(offer.tokenIdentifier, 'token identifier'),
    '--receiver-public-key',
    requiredHex(offer.receiverPublicKey, 'receiver public key'),
    '--amount',
    requiredAmount(offer.tokenAmount),
  ]
}

export async function pullAllowanceWithSpender(
  offer: Record<string, unknown>,
  spawnSpender: SpenderSpawn = defaultSpenderSpawn,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const args = pullArgs(offer)
  const result = await runSpender(args, spawnSpender, env)
  const txId = firstLine(result.stdout)
  if (result.code !== 0 || !txId || /\s/.test(txId)) {
    throw new SpenderPullUncertain(firstLine(result.stderr) || undefined, result.code)
  }
  return txId
}

export async function readSpenderPublicKey(
  spawnSpender: SpenderSpawn = defaultSpenderSpawn,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const result = await runSpender(['pubkey'], spawnSpender, env)
  const key = firstLine(result.stdout).toLowerCase()
  if (result.code !== 0 || !/^(02|03)[0-9a-f]{64}$/.test(key)) {
    const detail = firstLine(result.stderr)
    throw new Error(detail || 'zappi-allowance-spender pubkey did not print a key.')
  }
  return key
}

async function runSpender(
  args: readonly string[],
  spawnSpender: SpenderSpawn,
  env: NodeJS.ProcessEnv,
): Promise<SpenderRunResult> {
  try {
    return await spawnSpender(resolveSpenderBinary(env), args, sanitizedChildEnv(env))
  } catch (error) {
    if (isMissingBinary(error)) throw new SpenderNotFoundError()
    throw error
  }
}

function defaultSpenderSpawn(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<SpenderRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => reject(error))
    child.once('exit', (code) => {
      resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr })
    })
  })
}

function requiredHex(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]+$/.test(value.trim())) {
    throw new Error(`The allowance pull offer is missing ${label}.`)
  }
  return value.trim()
}

function requiredAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value.trim())) {
    throw new Error('The allowance pull offer is missing the token amount.')
  }
  return value.trim()
}

function firstLine(value: string): string {
  return value.trim().split('\n')[0]?.trim() ?? ''
}

function isMissingBinary(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
