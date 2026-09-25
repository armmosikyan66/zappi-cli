import { ZappiClient, type ZappiAuth } from '@zappimoney/zappi-sdk'
import {
  credentialsStillValid,
  readCliCredentials,
  writeCliCredentials,
  type CliCredentials,
} from './credentials.js'
import { resolvePaywallBase, type PotEnv } from './env.js'

/**
 * Build a {@link ZappiClient} pointed at the configured nest origin.
 *
 * Auth precedence:
 * 1. `ZAPPI_PROJECT_API_KEY` → `projectKey` (server-to-server).
 * 2. `ZAPPI_ACCESS_TOKEN` → `session` (user-scoped; forwards the access JWT
 *    plus optional cookie/user-agent). Used by pots / ledger / send commands.
 * 3. neither → throws. The CLI never ships a project key to the browser and
 *    never invents credentials.
 *
 * The pot seed (`ZAPPI_POT_SEED`) is NOT a client credential — it stays on the
 * host and is only used to sign Spark USDB transfers (see spark-send.ts).
 */
export function buildZappiClient(env: PotEnv = process.env): ZappiClient {
  const apiUrl = resolvePaywallBase(env)
  const projectApiKey = env.ZAPPI_PROJECT_API_KEY?.trim()
  const accessToken = env.ZAPPI_ACCESS_TOKEN?.trim()

  let auth: ZappiAuth
  if (projectApiKey) {
    auth = { kind: 'projectKey', projectApiKey }
  } else if (accessToken) {
    auth = {
      kind: 'session',
      projectApiKey: '', // session auth forwards the user JWT, not a project key
      accessToken,
      ...(env.ZAPPI_COOKIE?.trim() ? { cookie: env.ZAPPI_COOKIE.trim() } : {}),
      ...(env.ZAPPI_USER_AGENT?.trim()
        ? { userAgent: env.ZAPPI_USER_AGENT.trim() }
        : {}),
    }
  } else {
    throw new Error(
      'Set ZAPPI_PROJECT_API_KEY (server-to-server) or ZAPPI_ACCESS_TOKEN (user session) to call wallet routes. ' +
        'The pot seed is not a client credential — keep it as ZAPPI_POT_SEED.',
    )
  }

  return new ZappiClient({ apiUrl, auth })
}

/**
 * Env credentials win. Otherwise use the session saved by `zappi-cli login`,
 * refreshing it when the access token is near expiry.
 */
export async function resolveZappiClient(
  env: PotEnv = process.env,
): Promise<ZappiClient> {
  if (hasZappiCredentials(env)) return buildZappiClient(env)
  const stored = readCliCredentials(env)
  if (!stored) {
    throw new Error(
      'Set ZAPPI_PROJECT_API_KEY (server-to-server) or ZAPPI_ACCESS_TOKEN (user session), or run `zappi-cli login`. ' +
        'The pot seed is not a client credential — keep it as ZAPPI_POT_SEED.',
    )
  }
  const apiUrl = resolvePaywallBase(env)
  if (stored.apiUrl !== apiUrl) {
    throw new Error(
      `Saved login is for ${stored.apiUrl}. This command uses ${apiUrl}. ` +
        `Fix: run \`zappi-cli login\` against the intended API, or remove/logout the stale ~/.zappi/credentials.json. ` +
        `Do not bypass — do not read pot-client files or invent fetch/curl with a zpc_ token.`,
    )
  }
  const fresh = credentialsStillValid(stored)
    ? stored
    : await refreshStoredCredentials(stored, env)
  return buildZappiClient({ ...env, ZAPPI_ACCESS_TOKEN: fresh.accessToken })
}

async function refreshStoredCredentials(
  stored: CliCredentials,
  env: PotEnv,
): Promise<CliCredentials> {
  const response = await fetch(`${stored.apiUrl}/api/auth/token/refresh`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'zappi-cli',
    },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
  })
  const body = (await response.json().catch(() => null)) as {
    accessToken?: string
    refreshToken?: string
    expiresIn?: number
    user?: { email?: string }
  } | null
  if (!response.ok || !body?.accessToken || !body.refreshToken) {
    throw new Error('Saved login expired. Run `zappi-cli login` again.')
  }
  const next: CliCredentials = {
    version: 1,
    apiUrl: stored.apiUrl,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: new Date(Date.now() + Number(body.expiresIn ?? 900) * 1000).toISOString(),
    ...(body.user?.email || stored.email
      ? { email: body.user?.email ?? stored.email }
      : {}),
  }
  writeCliCredentials(next, env)
  return next
}

/** True when the env can build a client (used to gate wallet commands). */
export function hasZappiCredentials(env: PotEnv = process.env): boolean {
  return Boolean(env.ZAPPI_PROJECT_API_KEY?.trim() || env.ZAPPI_ACCESS_TOKEN?.trim())
}
