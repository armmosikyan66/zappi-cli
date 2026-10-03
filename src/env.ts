import { homedir } from 'node:os'
import { join } from 'node:path'
import { readStoredPotClientToken } from './attach-device-secret.js'

export interface PotEnv {
  ZAPPI_POT_ID?: string
  ZAPPI_POT_SEED?: string
  ZAPPI_POT_KEY_FILE?: string
  ZAPPI_API_URL?: string
  ZAPPI_PAYWALL_BASE?: string
  ZAPPI_APP_ORIGIN?: string
  ZAPPI_UNLOCK_TOKEN?: string
  /** Pot client token (`zpc_`) for auth-required spend tickets. Host secret. */
  ZAPPI_POT_CLIENT_TOKEN?: string
  /**
   * Unlock secret for the encrypted free-pot seed registry (`~/.zappi/pots.json`).
   * High-entropy host secret. Never printed, logged, or exported to `process.env`
   * by the CLI. Free pots only — not the main-wallet passphrase. (1-454/1-456)
   */
  ZAPPI_POT_PASSPHRASE?: string
  /** Override path for the encrypted free-pot seed registry. (1-454/1-456) */
  ZAPPI_POT_REGISTRY_FILE?: string
  /** Override path for the durable pending-operation journal. (1-456 stage 5) */
  ZAPPI_POT_PENDING_OPS_FILE?: string
  /** Per-payment cap (cents) for free-pot money-out paths. Defense in depth. (1-456 stage 5) */
  ZAPPI_POT_MAX_PER_PAYMENT_CENTS?: string
  /** Cumulative cap (cents) over the trailing 24h for free-pot money-out. (1-456 stage 5) */
  ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H?: string
  /** Runtime spend mode. `auth_required` refuses CLI free-sign (1-200). */
  ZAPPI_POT_SPEND_MODE?: string
  NEXT_PUBLIC_SITE_URL?: string
  SPARK_NETWORK?: string
  /** Project API key for server-to-server nest calls (projectKey auth). */
  ZAPPI_PROJECT_API_KEY?: string
  /** User access JWT for session-scoped nest calls (pots, ledger, send). */
  ZAPPI_ACCESS_TOKEN?: string
  /** Optional cookie header to forward for session auth. */
  ZAPPI_COOKIE?: string
  /** Optional user-agent to forward for session auth. */
  ZAPPI_USER_AGENT?: string
  /** Override for `zappi-cli login` credential file. Default `~/.zappi/credentials.json`. */
  ZAPPI_CREDENTIALS_FILE?: string
  /**
   * Expected Spark address for a legacy `ZAPPI_POT_SEED` / `ZAPPI_POT_KEY_FILE`
   * opt-out. Required before that seed may sign. Not a secret.
   */
  ZAPPI_POT_SPARK_ADDRESS?: string
  /** Derivation index for a legacy seed. Only 1 is valid. Unset means 1. */
  ZAPPI_POT_ACCOUNT_INDEX?: string
  /**
   * Attach deviceCode (RFC 8628) for reclaim after approve (1-203).
   * Host secret — never print. Wins over `~/.zappi/attach-device-<requestId>.txt`.
   */
  ZAPPI_ATTACH_DEVICE_CODE?: string
  /** Override home for `~/.zappi` host-secret files (tests / custom hosts). */
  ZAPPI_HOME?: string
}

export type PotSpendModeEnv = 'free' | 'auth_required'

export const PRODUCTION_ZAPPI_API_URL = 'https://api.zappi.money'
export const STAGING_ZAPPI_API_URL = 'https://api-dev.zappi.money'
/** Local nest (`server` PORT). Only when `ZAPPI_API_URL` is set to it. */
export const LOCAL_ZAPPI_API_URL = 'http://localhost:3011'
/** Published default. Unset env talks to the dev API, not this machine. */
export const DEFAULT_ZAPPI_API_URL = STAGING_ZAPPI_API_URL
/** Production web. Set `ZAPPI_API_URL` and `ZAPPI_APP_ORIGIN` together. */
export const PRODUCTION_ZAPPI_APP_ORIGIN = 'https://zappi.money'
/** Staging web. `http://dev.zappi.money` redirects here. Pair with `STAGING_ZAPPI_API_URL`. */
export const STAGING_ZAPPI_APP_ORIGIN = 'https://dev.zappi.money'
/** Local Next app. Only when the API host is local, or `ZAPPI_APP_ORIGIN` says so. */
export const LOCAL_ZAPPI_APP_ORIGIN = 'http://localhost:3000'
export const DEFAULT_ZAPPI_APP_ORIGIN = STAGING_ZAPPI_APP_ORIGIN

export function resolvePaywallBase(env: PotEnv = process.env): string {
  const base =
    env.ZAPPI_PAYWALL_BASE?.trim() ||
    env.ZAPPI_API_URL?.trim() ||
    DEFAULT_ZAPPI_API_URL
  return base.replace(/\/+$/, '')
}

export function resolveAppOrigin(env: PotEnv = process.env): string {
  const origin =
    env.ZAPPI_APP_ORIGIN?.trim() ||
    env.NEXT_PUBLIC_SITE_URL?.trim() ||
    DEFAULT_ZAPPI_APP_ORIGIN
  return safeOrigin(origin)
}

/**
 * Origin for links the human opens. An explicit app origin wins. Otherwise
 * the link host follows the API: local nest → localhost, production API →
 * zappi.money, and the dev API (the unset default) → dev.zappi.money.
 */
export function resolveLinkOrigin(env: PotEnv = process.env): string {
  if (env.ZAPPI_APP_ORIGIN?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim()) {
    return resolveAppOrigin(env)
  }
  return appOriginForApi(resolvePaywallBase(env))
}

function appOriginForApi(apiBase: string): string {
  let host = ''
  try {
    host = new URL(apiBase).hostname
  } catch {
    return DEFAULT_ZAPPI_APP_ORIGIN
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return LOCAL_ZAPPI_APP_ORIGIN
  }
  if (host === 'api.zappi.money') return PRODUCTION_ZAPPI_APP_ORIGIN
  return STAGING_ZAPPI_APP_ORIGIN
}

/** Keep the path and query. Replace the host with the app the human is using. */
export function relocateAppLink(href: string, appOrigin: string): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return href
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return href
  const origin = safeOrigin(appOrigin)
  let target: URL
  try {
    target = new URL(origin)
  } catch {
    return href
  }
  url.protocol = target.protocol
  url.host = target.host
  return url.toString()
}

function safeOrigin(origin: string): string {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_ZAPPI_APP_ORIGIN
    }
    return url.origin
  } catch {
    return DEFAULT_ZAPPI_APP_ORIGIN
  }
}

export function resolveSparkNetwork(env: PotEnv = process.env): 'MAINNET' {
  const raw = env.SPARK_NETWORK?.trim().toUpperCase()
  if (!raw || raw === 'MAINNET') return 'MAINNET'
  throw new Error('SPARK_NETWORK must be MAINNET. Regtest is not supported.')
}

export function resolvePotSpendMode(
  env: PotEnv = process.env,
): PotSpendModeEnv {
  const raw = env.ZAPPI_POT_SPEND_MODE?.trim().toLowerCase()
  return raw === 'auth_required' ? 'auth_required' : 'free'
}

export const AUTH_REQUIRED_PAY_ERROR =
  'This pot is auth_required. Do not free-sign with pay. Run `zappi-cli request --amount-cents <cents> --to <spark-address>` and paste the approve URL. Do not ask for a session token, the pot seed, or a recovery phrase.'

/** This host already holds a pot client token. Do not mint another pairing link. */
export const POT_ALREADY_ATTACHED_ERROR =
  'This host is already attached to this pot. Do not create another pairing link.'

export function hostHasPotClientToken(env: PotEnv = process.env): boolean {
  const fromEnv = env.ZAPPI_POT_CLIENT_TOKEN?.trim()
  if (
    fromEnv?.startsWith('zpc_') &&
    !(fromEnv.startsWith('<') && fromEnv.endsWith('>'))
  ) {
    return true
  }
  return Boolean(readStoredPotClientToken(env))
}

/** Fail closed: no attach → no request. Do not ask the human to paste zpc_. */
export const POT_NOT_ATTACHED_ERROR =
  'This pot is not attached to the account. The bot cannot request, pay, consume, or invite until pairing is approved. Run `zappi-cli pots attach --spend-mode auth_required` and paste only the pairing URL. If the link does not open, they paste the verification code on the Zappi pairing page — not in chat. Do not print or check a verification code. Do not ask for a zpc_ token, session token, pot seed, or recovery phrase.'

/**
 * Pot client token for `request`. Env wins, else `~/.zappi/pot-client-*.txt`
 * from attach reclaim. Never a CLI flag (`ps`). Does not read `ZAPPI_ACCESS_TOKEN`.
 */
export function resolvePotClientToken(env: PotEnv = process.env): string {
  const fromEnv = env.ZAPPI_POT_CLIENT_TOKEN?.trim()
  if (fromEnv) {
    if (fromEnv.startsWith('<') && fromEnv.endsWith('>')) {
      throw new Error(
        'Pot client token is still a placeholder. Set ZAPPI_POT_CLIENT_TOKEN as a host secret — do not paste it into chat.',
      )
    }
    if (!fromEnv.startsWith('zpc_')) {
      throw new Error(
        'ZAPPI_POT_CLIENT_TOKEN must be a pot client token (zpc_). Do not pass a session token, pot seed, or recovery phrase.',
      )
    }
    return fromEnv
  }
  const fromFile = readStoredPotClientToken(env)
  if (!fromFile) {
    throw new Error(POT_NOT_ATTACHED_ERROR)
  }
  return fromFile
}

/**
 * Auth-required pots cannot invite, consume, or request until attach is
 * approved on this host. Free pots skip this check.
 */
export function requireAuthRequiredPotAttached(
  env: PotEnv = process.env,
): void {
  if (resolvePotSpendMode(env) !== 'auth_required') return
  resolvePotClientToken(env)
}

export function requirePotId(env: PotEnv = process.env): string {
  const potId = env.ZAPPI_POT_ID?.trim()
  if (!potId) {
    throw new Error(
      'Set ZAPPI_POT_ID (from the Zappi pot install snippet). Do not paste the pot key into chat.',
    )
  }
  return potId
}

/**
 * Unlock bearer for paid GET / consume.
 * Env `ZAPPI_UNLOCK_TOKEN` wins over `--unlock-token` so scripts stay secret-file based.
 */
export function resolveUnlockToken(
  env: PotEnv = process.env,
  flagValue?: string,
): string {
  const fromEnv = env.ZAPPI_UNLOCK_TOKEN?.trim()
  const fromFlag = flagValue?.trim()
  const token = fromEnv || fromFlag
  if (!token) {
    throw new Error(
      'Set ZAPPI_UNLOCK_TOKEN or pass --unlock-token. Do not paste it into chat.',
    )
  }
  if (token.startsWith('<') && token.endsWith('>')) {
    throw new Error(
      'Unlock token is still a placeholder. Set ZAPPI_UNLOCK_TOKEN as a host secret — do not paste it into chat.',
    )
  }
  return token
}

export function parsePositiveUnits(
  raw: string | undefined,
  fallback = 1,
): number {
  if (raw == null || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('--units must be a positive integer.')
  }
  return parsed
}

/**
 * Unlock secret for the encrypted free-pot seed registry. Host secret only —
 * never a CLI flag (would leak to `ps`/shell history). Placeholder guard
 * mirrors `resolveUnlockToken` so docs examples are not treated as secrets.
 * This is a free-pot registry secret, NOT the human device wallet passphrase.
 */
export const MIN_POT_PASSPHRASE_LENGTH = 16

export function resolvePotPassphrase(env: PotEnv = process.env): string {
  const fromEnv = env.ZAPPI_POT_PASSPHRASE?.trim()
  if (!fromEnv) {
    throw new Error(
      'Set ZAPPI_POT_PASSPHRASE as a host secret to unlock the free-pot seed registry. Do not paste it into chat. This is not the device wallet passphrase.',
    )
  }
  if (fromEnv.startsWith('<') && fromEnv.endsWith('>')) {
    throw new Error(
      'ZAPPI_POT_PASSPHRASE is still a placeholder. Set it as a host secret — do not paste it into chat.',
    )
  }
  if (fromEnv.length < MIN_POT_PASSPHRASE_LENGTH) {
    throw new Error(
      `ZAPPI_POT_PASSPHRASE must be at least ${MIN_POT_PASSPHRASE_LENGTH} characters. Set a high-entropy host secret.`,
    )
  }
  return fromEnv
}

/**
 * Spend mode for the free signer. Unset means free. `auth_required` and any
 * other value are rejected by the signer before it reads a seed. This does
 * not change the auth-required request/approve path, which uses
 * {@link resolvePotSpendMode}.
 */
export function assertFreeSignerSpendMode(env: PotEnv = process.env): void {
  const raw = env.ZAPPI_POT_SPEND_MODE?.trim().toLowerCase()
  if (!raw || raw === 'free') return
  if (raw === 'auth_required') {
    throw new Error(AUTH_REQUIRED_PAY_ERROR)
  }
  throw new Error(
    `Unknown ZAPPI_POT_SPEND_MODE "${raw}". Refusing to sign. Expected free or auth_required.`,
  )
}

/** Registry file path. Default `~/.zappi/pots.json`; override `ZAPPI_POT_REGISTRY_FILE`. */
export function potRegistryPath(env: PotEnv = process.env): string {
  const override = env.ZAPPI_POT_REGISTRY_FILE?.trim()
  if (override) return override
  return join(homedir(), '.zappi', 'pots.json')
}
