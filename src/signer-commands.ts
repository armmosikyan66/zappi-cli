import { spawn } from 'node:child_process'

/**
 * Path to the zappi-signer binary. `--signer` wins, then this variable,
 * then `zappi-signer` on PATH.
 */
export const SIGNER_BIN_ENV = 'ZAPPI_SIGNER_BIN'

const DEFAULT_SIGNER_BIN = 'zappi-signer'

const SIGNER_CLI_COMMANDS = [
  'sign',
  'signer-status',
  'provision',
  'prove-address',
  'policy',
  'backup',
  'restore',
] as const

const SIGN_USAGE = 'Usage: zappi-cli sign <requestId> [--yes] [--signer <path>]'
const STATUS_USAGE = 'Usage: zappi-cli signer-status <requestId> [--signer <path>]'
const SIGNER_FLAG_USAGE = 'Usage: --signer <path>'

export type SignerCliCommand = (typeof SIGNER_CLI_COMMANDS)[number]

export interface SignerSpawnOptions {
  stdio: 'inherit'
  /** Full parent environment. The signer reads ZAPPI_SIGNER_API_URL from here. */
  env: NodeJS.ProcessEnv
}

type SignerListener = (...args: unknown[]) => void

export interface SignerChild {
  once(event: 'error' | 'exit', listener: SignerListener): void
}

export type SignerSpawn = (
  command: string,
  args: readonly string[],
  options: SignerSpawnOptions,
) => SignerChild

/** Child already wrote its own stderr. The entrypoint must not print again. */
export class SignerChildExit extends Error {
  readonly signerExitCode: number

  constructor(code: number) {
    super(`zappi-signer exited with code ${code}`)
    this.name = 'SignerChildExit'
    this.signerExitCode = code
  }
}

export class SignerNotFoundError extends Error {
  readonly exitCode = 1

  constructor() {
    super(
      'zappi-signer was not found on PATH. Set ZAPPI_SIGNER_BIN to the binary path.',
    )
    this.name = 'SignerNotFoundError'
  }
}

export function isSignerCliCommand(command: string): command is SignerCliCommand {
  return (SIGNER_CLI_COMMANDS as readonly string[]).includes(command)
}

export function forwardedSignerExitCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('signerExitCode' in error)) {
    return undefined
  }
  const code = (error as { signerExitCode: unknown }).signerExitCode
  if (typeof code !== 'number' || !Number.isInteger(code)) return undefined
  return code
}

export function resolveSignerBinary(
  signerFlag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (signerFlag !== undefined && signerFlag.length > 0) return signerFlag
  const configured = env[SIGNER_BIN_ENV]
  if (configured !== undefined && configured.length > 0) return configured
  return DEFAULT_SIGNER_BIN
}

/**
 * Spawn zappi-signer and wait until it exits.
 * The signer owns the TTY confirm. This process does not cache a requestId:
 * every call spawns again, and idempotency belongs to the signer.
 * The child receives the parent environment so ZAPPI_SIGNER_API_URL and the
 * signer's other host settings stay available. This does not pick a backend.
 */
export async function runSignerCli(
  command: SignerCliCommand,
  argv: readonly string[],
  spawnSigner: SignerSpawn = defaultSignerSpawn,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const { signerPath, rest } = splitSignerFlag(argv)
  const childArgs = childArgsFor(command, rest)
  const binary = resolveSignerBinary(signerPath, env)
  const code = await waitForSigner(
    spawnSigner(binary, childArgs, { stdio: 'inherit', env }),
  )
  if (code !== 0) throw new SignerChildExit(code)
}

function defaultSignerSpawn(
  command: string,
  args: readonly string[],
  options: SignerSpawnOptions,
): SignerChild {
  const child = spawn(command, [...args], {
    stdio: options.stdio,
    env: options.env,
    shell: false,
  })
  return {
    once(event, listener) {
      if (event === 'error') {
        child.once('error', (error) => listener(error))
        return
      }
      child.once('exit', (code, signal) => listener(code, signal))
    },
  }
}

function splitSignerFlag(argv: readonly string[]): { signerPath?: string; rest: string[] } {
  const rest: string[] = []
  let signerPath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? ''
    if (arg === '--signer') {
      const next = argv[index + 1]
      if (next === undefined || next.length === 0 || next.startsWith('-')) {
        throw new Error(SIGNER_FLAG_USAGE)
      }
      signerPath = next
      index += 1
      continue
    }
    if (arg.startsWith('--signer=')) {
      const value = arg.slice('--signer='.length)
      if (value.length === 0) throw new Error(SIGNER_FLAG_USAGE)
      signerPath = value
      continue
    }
    rest.push(arg)
  }
  return { signerPath, rest }
}

function childArgsFor(command: SignerCliCommand, rest: readonly string[]): string[] {
  if (command === 'sign') return signChildArgs(rest)
  if (command === 'signer-status') return statusChildArgs(rest)
  return [command, ...rest]
}

function signChildArgs(rest: readonly string[]): string[] {
  let confirmed = false
  const positionals: string[] = []
  for (const arg of rest) {
    if (arg === '--yes') {
      confirmed = true
      continue
    }
    if (arg.startsWith('-')) throw new Error(SIGN_USAGE)
    positionals.push(arg)
  }
  const requestId = positionals.length === 1 ? positionals[0] : undefined
  if (requestId === undefined || requestId.length === 0) throw new Error(SIGN_USAGE)
  const args = ['sign', requestId]
  if (confirmed) args.push('--yes')
  return args
}

function statusChildArgs(rest: readonly string[]): string[] {
  const positionals: string[] = []
  for (const arg of rest) {
    if (arg.startsWith('-')) throw new Error(STATUS_USAGE)
    positionals.push(arg)
  }
  const requestId = positionals.length === 1 ? positionals[0] : undefined
  if (requestId === undefined || requestId.length === 0) throw new Error(STATUS_USAGE)
  return ['status', requestId]
}

function waitForSigner(child: SignerChild): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      settle()
    }

    child.once('error', (...args) => {
      finish(() => reject(spawnFailure(args[0])))
    })
    child.once('exit', (...args) => {
      finish(() => {
        const signal = args[1]
        if (signal) {
          resolve(1)
          return
        }
        const code = args[0]
        resolve(typeof code === 'number' ? code : 1)
      })
    })
  })
}

function spawnFailure(error: unknown): Error {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  if (code === 'ENOENT') return new SignerNotFoundError()
  if (error instanceof Error) return error
  return new Error('Failed to start zappi-signer')
}
