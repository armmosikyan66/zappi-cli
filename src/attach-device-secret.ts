import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PotEnv } from './env.js'

const FILE_MODE = 0o600
const DIR_MODE = 0o700

/** Directory for host-secret files (`~/.zappi` or `ZAPPI_HOME`). */
export function zappiHomeDir(env: PotEnv = process.env): string {
  const override = env.ZAPPI_HOME?.trim()
  if (override) return override
  return join(homedir(), '.zappi')
}

/** `~/.zappi/attach-device-<requestId>.txt` (mode 0600). Never print contents. */
export function attachDeviceCodePath(requestId: string, env: PotEnv = process.env): string {
  const safe = requestId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return join(zappiHomeDir(env), `attach-device-${safe}.txt`)
}

/** `~/.zappi/pot-client-<requestId>.txt` (mode 0600) for reclaimed `zpc_`. */
export function potClientTokenPath(requestId: string, env: PotEnv = process.env): string {
  const safe = requestId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return join(zappiHomeDir(env), `pot-client-${safe}.txt`)
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE })
  if (process.platform !== 'win32') {
    try {
      chmodSync(dirname(path), DIR_MODE)
    } catch {
      // Directory may already exist with a tighter mode.
    }
  }
}

function writeSecretFile(path: string, value: string): string {
  ensureDir(path)
  writeFileSync(path, `${value.trim()}\n`, { encoding: 'utf8', mode: FILE_MODE })
  if (process.platform !== 'win32') chmodSync(path, FILE_MODE)
  return path
}

/**
 * Persist attach deviceCode as a host secret. Never log or print `deviceCode`.
 * Returns the file path written (or null when empty).
 */
export function writeAttachDeviceCode(
  requestId: string,
  deviceCode: string,
  env: PotEnv = process.env,
): string | null {
  const trimmed = deviceCode.trim()
  if (!trimmed) return null
  return writeSecretFile(attachDeviceCodePath(requestId, env), trimmed)
}

/**
 * Resolve deviceCode for reclaim: `ZAPPI_ATTACH_DEVICE_CODE` env wins, else
 * `~/.zappi/attach-device-<requestId>.txt`. Never echoes the value.
 */
export function resolveAttachDeviceCode(
  requestId: string,
  env: PotEnv = process.env,
): string | null {
  const fromEnv = env.ZAPPI_ATTACH_DEVICE_CODE?.trim()
  if (fromEnv) return fromEnv
  const path = attachDeviceCodePath(requestId, env)
  try {
    const raw = readFileSync(path, 'utf8').trim()
    return raw || null
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
}

/**
 * Persist reclaimed pot client token (`zpc_`) as a host-secret file.
 * Caller should also hint to set `ZAPPI_POT_CLIENT_TOKEN`. Never print token.
 */
export function writePotClientTokenFile(
  requestId: string,
  potClientToken: string,
  env: PotEnv = process.env,
): string | null {
  const trimmed = potClientToken.trim()
  if (!trimmed) return null
  return writeSecretFile(potClientTokenPath(requestId, env), trimmed)
}
