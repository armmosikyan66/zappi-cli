import { rmSync } from 'node:fs'
import { heading, infoLine, kv, successLine, type OutputMode } from './ui.js'
import { parseArgs } from './args.js'
import {
  credentialsPath,
  readCliCredentials,
  writeCliCredentials,
  type CliCredentials,
} from './credentials.js'
import { resolvePaywallBase, type PotEnv } from './env.js'
import { openUrl } from './wizard-io.js'

const NL = '\n'

export interface LoginDeps {
  fetchImpl?: typeof fetch
  openUrl?: (href: string) => void
  sleep?: (ms: number) => Promise<void>
  writeErr?: (text: string) => void
}

interface DeviceStart {
  deviceCode: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

interface TokenGrant {
  accessToken: string
  refreshToken: string
  expiresIn: number
  email?: string
}

/**
 * `zappi-cli login [--no-browser]`
 *
 * Opens the Zappi sign-in screen (email or passkey). Signing in there saves
 * a session on this terminal. The session is never printed.
 */
export async function runLogin(
  argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: LoginDeps = {},
): Promise<string> {
  const { booleans } = parseArgs(argv)
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const writeErr = deps.writeErr ?? ((text) => process.stderr.write(text))
  const open = deps.openUrl ?? openUrl
  const apiUrl = resolvePaywallBase(env)

  const started = await postJson<DeviceStart>(
    fetchImpl,
    `${apiUrl}/api/auth/cli/device`,
    {},
  )
  if (!started.deviceCode || !started.verificationUriComplete) {
    throw new Error('Zappi did not start a login. Try again.')
  }

  writeErr(`Sign in with your email or a passkey.${NL}`)
  writeErr(`${started.verificationUriComplete}${NL}`)
  if (!booleans['no-browser']) {
    try {
      open(started.verificationUriComplete)
    } catch {
      writeErr(`Could not open a browser. Open the link above.${NL}`)
    }
  }

  const deadline = Date.now() + Math.max(1, started.expiresIn) * 1000
  let intervalSec = Math.max(1, started.interval || 5)
  const grant = await pollUntilApproved({
    fetchImpl,
    apiUrl,
    deviceCode: started.deviceCode,
    deadline,
    intervalSec,
    sleep,
  })

  const path = writeCliCredentials(
    {
      version: 1,
      apiUrl,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: new Date(Date.now() + grant.expiresIn * 1000).toISOString(),
      ...(grant.email ? { email: grant.email } : {}),
    },
    env,
  )

  const result = {
    ok: true as const,
    command: 'login' as const,
    email: grant.email ?? null,
    credentialsFile: path,
  }
  if (mode === 'json') return JSON.stringify(result, null, 2)
  const lines = [
    heading('Signed in', mode),
    ...(grant.email ? [successLine(grant.email, mode)] : [successLine('Session saved', mode)]),
    kv('credentials', path, mode),
    infoLine(
      'Wallet commands on this terminal can use this login. Propose and pay still use the pot key.',
      mode,
    ),
  ]
  return lines.join(NL)
}

/** `zappi-cli logout` — revokes the saved session and deletes the file. */
export async function runLogout(
  _argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: LoginDeps = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const stored = readCliCredentials(env)
  const token = env.ZAPPI_ACCESS_TOKEN?.trim() || stored?.accessToken
  const apiUrl = stored?.apiUrl || resolvePaywallBase(env)
  if (token) {
    await fetchImpl(`${apiUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'zappi-cli',
        'x-zappi-access-token': token,
      },
      body: '{}',
    }).catch(() => undefined)
  }
  try {
    rmSync(credentialsPath(env), { force: true })
  } catch {
    // The file is already gone.
  }
  const result = { ok: true as const, command: 'logout' as const }
  if (mode === 'json') return JSON.stringify(result, null, 2)
  return successLine('Signed out of this terminal.', mode)
}

/** `zappi-cli whoami` */
export async function runWhoami(
  _argv: string[],
  mode: OutputMode,
  env: PotEnv = process.env,
  deps: LoginDeps = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const stored = env.ZAPPI_ACCESS_TOKEN?.trim() ? null : readCliCredentials(env)
  const token = env.ZAPPI_ACCESS_TOKEN?.trim() || stored?.accessToken
  if (!token) {
    throw new Error('This terminal is not signed in. Run `zappi-cli login`.')
  }
  const apiUrl = stored?.apiUrl || resolvePaywallBase(env)
  const response = await fetchImpl(`${apiUrl}/api/auth/me`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'zappi-cli',
      'x-zappi-access-token': token,
    },
  })
  const body = (await response.json().catch(() => null)) as {
    user?: { email?: string; username?: string }
    message?: string
  } | null
  if (!response.ok) {
    throw new Error(body?.message || 'Could not read the signed-in account. Run `zappi-cli login` again.')
  }
  const email = body?.user?.email ?? stored?.email ?? ''
  const username = body?.user?.username ?? ''
  const result = {
    ok: true as const,
    command: 'whoami' as const,
    email: email || null,
    username: username || null,
  }
  if (mode === 'json') return JSON.stringify(result, null, 2)
  return [
    heading('Account', mode),
    ...(email ? [kv('email', email, mode)] : []),
    ...(username ? [kv('username', username, mode)] : []),
  ].join(NL)
}

async function pollUntilApproved(input: {
  fetchImpl: typeof fetch
  apiUrl: string
  deviceCode: string
  deadline: number
  intervalSec: number
  sleep: (ms: number) => Promise<void>
}): Promise<TokenGrant> {
  let intervalSec = input.intervalSec
  while (Date.now() < input.deadline) {
    await input.sleep(intervalSec * 1000)
    const response = await input.fetchImpl(`${input.apiUrl}/api/auth/cli/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'zappi-cli',
      },
      body: JSON.stringify({ deviceCode: input.deviceCode }),
    })
    const body = (await response.json().catch(() => null)) as {
      error?: string
      message?: string
      interval?: number
      accessToken?: string
      refreshToken?: string
      expiresIn?: number
      email?: string
    } | null
    const error = body?.error
    if (response.ok && body?.accessToken && body.refreshToken) {
      return {
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        expiresIn: body.expiresIn ?? 900,
        email: body.email,
      }
    }
    if (error === 'authorization_pending' || error === 'slow_down') {
      if (typeof body?.interval === 'number' && body.interval > 0) {
        intervalSec = body.interval
      } else if (error === 'slow_down') {
        intervalSec += 5
      }
      continue
    }
    throw new Error(body?.message || 'Zappi login failed.')
  }
  throw new Error('Login timed out. Run `zappi-cli login` again.')
}

async function postJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'zappi-cli',
    },
    body: JSON.stringify(body),
  })
  const parsed = (await response.json().catch(() => null)) as (T & { message?: string }) | null
  if (!response.ok || !parsed) {
    throw new Error(parsed?.message || 'Could not reach Zappi to start login.')
  }
  return parsed
}

export function savedLogin(env: PotEnv = process.env): CliCredentials | null {
  return readCliCredentials(env)
}
