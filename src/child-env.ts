import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process'

/**
 * Host secrets that must not be inherited by browser, clipboard, or any other
 * child process. Matching is by exact name and by a credential-shaped suffix
 * so a future secret env var is not forwarded by default.
 */
const SECRET_ENV_KEYS = [
  'ZAPPI_POT_SEED',
  'ZAPPI_POT_PASSPHRASE',
  'ZAPPI_POT_KEY_FILE',
  'ZAPPI_POT_CLIENT_TOKEN',
  'ZAPPI_UNLOCK_TOKEN',
  'ZAPPI_ACCESS_TOKEN',
  'ZAPPI_PROJECT_API_KEY',
  'ZAPPI_COOKIE',
  'ZAPPI_ATTACH_DEVICE_CODE',
] as const

const SECRET_ENV_PATTERN =
  /(?:SEED|PASSPHRASE|SECRET|TOKEN|API_KEY|COOKIE|DEVICE_CODE|KEY_FILE)/i

export function sanitizedChildEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const key of Object.keys(env)) {
    if (
      (SECRET_ENV_KEYS as readonly string[]).includes(key) ||
      SECRET_ENV_PATTERN.test(key)
    ) {
      delete env[key]
    }
  }
  return env
}

/** Spawn a child with host credentials removed from its environment. */
export function spawnSanitized(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  return spawn(command, args, {
    ...options,
    env: sanitizedChildEnv(options.env ?? process.env),
  })
}
