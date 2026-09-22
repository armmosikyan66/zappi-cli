/**
 * Minimal flag parser shared by the new wallet/pot/send CLI commands.
 * Returns known string flags, a boolean set, and positional args.
 *
 * Intentionally tiny — the CLI already has richer parsers for pay/consume;
 * these commands just need `--flag value` + positionals + `--json` (stripped
 * earlier by stripJsonFlag).
 */
export interface ParsedArgs {
  /** Positional (non-flag) arguments in order. */
  positionals: string[]
  /** String flags: `--asset USDC` → { asset: 'USDC' }. */
  strings: Record<string, string>
  /** Boolean flags: `--json` → { json: true }. */
  booleans: Record<string, boolean>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const strings: Record<string, string> = {}
  const booleans: Record<string, boolean> = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=')
      if (eqIndex > 2) {
        const key = arg.slice(2, eqIndex)
        const value = arg.slice(eqIndex + 1)
        strings[key] = value
        continue
      }
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        booleans[key] = true
      } else {
        strings[key] = next
        i += 1
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      booleans[arg.slice(1)] = true
    } else {
      positionals.push(arg)
    }
  }

  return { positionals, strings, booleans }
}

/** Parse a positive integer from a string flag, throwing on invalid. */
export function parseIntFlag(value: string | undefined, name: string): number {
  if (value == null || value === '') {
    throw new Error(`Missing --${name}`)
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer.`)
  }
  return parsed
}
