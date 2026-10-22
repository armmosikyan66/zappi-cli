import { readCliCredentials } from './credentials.js'
import { guestMatchesApi, readCliGuest } from './cli-guest.js'
import { resolvePaywallBase, type PotEnv } from './env.js'
import { redactSecrets } from './paywall-http.js'

export interface CliHttpDeps {
  fetchImpl?: typeof fetch
}

export function cliAccessToken(env: PotEnv): string | null {
  const fromEnv = env.ZAPPI_ACCESS_TOKEN?.trim()
  if (fromEnv) return fromEnv
  const stored = readCliCredentials(env)
  if (!stored) return null
  const apiUrl = resolvePaywallBase(env)
  if (stored.apiUrl !== apiUrl) {
    throw new Error(
      `Saved login is for ${stored.apiUrl}, but this command uses ${apiUrl}. Run zappi-cli login again.`,
    )
  }
  return stored.accessToken
}

/** A saved login or a saved guest file. Throws when the saved login is for another API. */
export function hasCliActor(env: PotEnv): boolean {
  if (cliAccessToken(env)) return true
  const guest = readCliGuest(env)
  if (!guest) return false
  if (!guestMatchesApi(guest, env)) {
    throw new Error(
      `Saved guest is for ${guest.apiUrl}, but this command uses ${resolvePaywallBase(env)}. Run zappi-cli guest again.`,
    )
  }
  return true
}

export async function cliRequest(
  env: PotEnv,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; query?: Record<string, string> } = {},
  deps: CliHttpDeps = {},
): Promise<Record<string, unknown>> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'zappi-cli',
  }
  const token = cliAccessToken(env)
  if (token) {
    headers['x-zappi-access-token'] = token
  } else {
    const guest = readCliGuest(env)
    if (guest) {
      if (!guestMatchesApi(guest, env)) {
        throw new Error(
          `Saved guest is for ${guest.apiUrl}, but this command uses ${resolvePaywallBase(env)}. Run zappi-cli guest again.`,
        )
      }
      headers['x-zappi-cli-guest'] = guest.secret
    }
  }
  if (init.body) headers['Content-Type'] = 'application/json'
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value) query.set(key, value)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  const response = await fetchImpl(`${resolvePaywallBase(env)}${path}${suffix}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `Zappi returned HTTP ${response.status}.`
    throw new Error(redactSecrets(message))
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Zappi returned a response this command could not read.')
  }
  return body as Record<string, unknown>
}
