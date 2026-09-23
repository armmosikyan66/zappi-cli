import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolvePaywallBase, type PotEnv } from './env.js'

export interface CliCredentials {
  version: 1
  apiUrl: string
  accessToken: string
  refreshToken: string
  /** ISO time when the access token expires. */
  expiresAt: string
  email?: string
}

const FILE_MODE = 0o600
const DIR_MODE = 0o700

export function credentialsPath(env: PotEnv = process.env): string {
  const override = env.ZAPPI_CREDENTIALS_FILE?.trim()
  if (override) return override
  return join(homedir(), '.zappi', 'credentials.json')
}

export function readCliCredentials(env: PotEnv = process.env): CliCredentials | null {
  const path = credentialsPath(env)
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
  const parsed = JSON.parse(raw) as Partial<CliCredentials>
  if (
    parsed.version !== 1 ||
    typeof parsed.apiUrl !== 'string' ||
    typeof parsed.accessToken !== 'string' ||
    typeof parsed.refreshToken !== 'string' ||
    typeof parsed.expiresAt !== 'string'
  ) {
    throw new Error(`Saved login at ${path} is not a Zappi credentials file. Run zappi-cli login again.`)
  }
  return {
    version: 1,
    apiUrl: parsed.apiUrl.replace(/\/+$/, ''),
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
    ...(typeof parsed.email === 'string' ? { email: parsed.email } : {}),
  }
}

export function writeCliCredentials(
  credentials: CliCredentials,
  env: PotEnv = process.env,
): string {
  const path = credentialsPath(env)
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE })
  if (process.platform !== 'win32') {
    try {
      chmodSync(dirname(path), DIR_MODE)
    } catch {
      // The directory may already exist with a tighter mode.
    }
  }
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: FILE_MODE,
  })
  if (process.platform !== 'win32') chmodSync(path, FILE_MODE)
  return path
}

export function credentialsStillValid(credentials: CliCredentials, now = Date.now()): boolean {
  const expires = Date.parse(credentials.expiresAt)
  if (!Number.isFinite(expires)) return false
  return expires - now > 60_000
}

export function sameApi(credentials: CliCredentials, env: PotEnv): boolean {
  return credentials.apiUrl === resolvePaywallBase(env)
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
