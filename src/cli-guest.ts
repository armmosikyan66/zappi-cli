import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolvePaywallBase, type PotEnv } from './env.js'

export interface CliGuestFile {
  version: 1
  apiUrl: string
  secret: string
}

const FILE_MODE = 0o600
const DIR_MODE = 0o700

export function cliGuestPath(env: PotEnv = process.env): string {
  const override = env.ZAPPI_CLI_GUEST_FILE?.trim()
  if (override) return override
  return join(homedir(), '.zappi', 'agent.json')
}

export function readCliGuest(env: PotEnv = process.env): CliGuestFile | null {
  const path = cliGuestPath(env)
  let raw: string
  try {
    const stat = statSync(path)
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error(
        `Refusing to read ${path}: other users can read it. Run chmod 600 ${path}`,
      )
    }
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  const parsed = JSON.parse(raw) as Partial<CliGuestFile>
  if (
    parsed.version !== 1 ||
    typeof parsed.apiUrl !== 'string' ||
    typeof parsed.secret !== 'string' ||
    !parsed.secret.startsWith('zcg_')
  ) {
    throw new Error(`Saved guest at ${path} is not a Zappi guest file. Run zappi-cli guest again.`)
  }
  return {
    version: 1,
    apiUrl: parsed.apiUrl.replace(/\/+$/, ''),
    secret: parsed.secret,
  }
}

export function writeCliGuest(guest: CliGuestFile, env: PotEnv = process.env): string {
  const path = cliGuestPath(env)
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE })
  if (process.platform !== 'win32') {
    try {
      chmodSync(dirname(path), DIR_MODE)
    } catch {
      // The directory may already exist with a tighter mode.
    }
  }
  writeFileSync(
    path,
    `${JSON.stringify(
      { version: 1, apiUrl: guest.apiUrl.replace(/\/+$/, ''), secret: guest.secret },
      null,
      2,
    )}\n`,
    { mode: FILE_MODE },
  )
  if (process.platform !== 'win32') chmodSync(path, FILE_MODE)
  return path
}

export function deleteCliGuest(env: PotEnv = process.env): void {
  rmSync(cliGuestPath(env), { force: true })
}

export function guestMatchesApi(guest: CliGuestFile, env: PotEnv): boolean {
  return guest.apiUrl === resolvePaywallBase(env)
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
