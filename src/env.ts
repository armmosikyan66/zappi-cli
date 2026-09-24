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
   * Attach deviceCode (RFC 8628) for reclaim after approve (1-203).
   * Host secret — never print. Wins over `~/.zappi/attach-device-<requestId>.txt`.
   */
  ZAPPI_ATTACH_DEVICE_CODE?: string
  /** Override home for `~/.zappi` host-secret files (tests / custom hosts). */
  ZAPPI_HOME?: string
}

export type PotSpendModeEnv = 'free' | 'auth_required'

export const DEFAULT_ZAPPI_API_URL = 'https://api.zappi.money'
export const STAGING_ZAPPI_API_URL = 'https://api-dev.zappi.money'
/** Production web. Staging dogfood must set this with `ZAPPI_API_URL`. */
export const DEFAULT_ZAPPI_APP_ORIGIN = 'https://zappi.money'
/** Staging web — pair with `STAGING_ZAPPI_API_URL`. */
export const STAGING_ZAPPI_APP_ORIGIN = 'http://dev.zappi.money'

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

export function resolveSparkNetwork(
  env: PotEnv = process.env,
): 'MAINNET' | 'REGTEST' {
  const raw = env.SPARK_NETWORK?.trim().toUpperCase()
  return raw === 'REGTEST' ? 'REGTEST' : 'MAINNET'
}

export function resolvePotSpendMode(
  env: PotEnv = process.env,
): PotSpendModeEnv {
  const raw = env.ZAPPI_POT_SPEND_MODE?.trim().toLowerCase()
  return raw === 'auth_required' ? 'auth_required' : 'free'
}

export const AUTH_REQUIRED_PAY_ERROR =
  'This pot is auth_required. Do not free-sign with pay. Run `zappi-cli request --amount-cents <cents> --to <spark-address>` and paste the approve URL. Do not ask for a session token, the pot seed, or a recovery phrase.'

const POT_CLIENT_TOKEN_HINT =
  'Set ZAPPI_POT_CLIENT_TOKEN (the zpc_ from attach approve) as a host secret. Do not ask for a session token, the pot seed, or a recovery phrase.'

/**
 * Pot client token for `request`. Env only — never a CLI flag (it would show in `ps`).
 * Does not read `ZAPPI_ACCESS_TOKEN`.
 */
export function resolvePotClientToken(env: PotEnv = process.env): string {
  const token = env.ZAPPI_POT_CLIENT_TOKEN?.trim()
  if (!token) {
    throw new Error(POT_CLIENT_TOKEN_HINT)
  }
  if (token.startsWith('<') && token.endsWith('>')) {
    throw new Error(
      'Pot client token is still a placeholder. Set ZAPPI_POT_CLIENT_TOKEN as a host secret — do not paste it into chat.',
    )
  }
  if (!token.startsWith('zpc_')) {
    throw new Error(
      'ZAPPI_POT_CLIENT_TOKEN must be a pot client token (zpc_). Do not pass a session token, pot seed, or recovery phrase.',
    )
  }
  return token
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
