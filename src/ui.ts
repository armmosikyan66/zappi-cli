import pc from 'picocolors'
import ora, { type Ora } from 'ora'

export type OutputMode = 'pretty' | 'plain' | 'json'

export function colorEnabled(mode: OutputMode = 'pretty'): boolean {
  if (mode !== 'pretty') return false
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR === '0') return false
  return Boolean(process.stdout.isTTY)
}

export function paint(mode: OutputMode = 'pretty') {
  const on = colorEnabled(mode)
  return {
    bold: (s: string) => (on ? pc.bold(s) : s),
    dim: (s: string) => (on ? pc.dim(s) : s),
    cyan: (s: string) => (on ? pc.cyan(s) : s),
    green: (s: string) => (on ? pc.green(s) : s),
    yellow: (s: string) => (on ? pc.yellow(s) : s),
    red: (s: string) => (on ? pc.red(s) : s),
    magenta: (s: string) => (on ? pc.magenta(s) : s),
  }
}

export const symbol = {
  success: '✔',
  warn: '⚠',
  error: '✖',
  info: '›',
  step: '→',
} as const

export function successLine(text: string, mode: OutputMode = 'pretty'): string {
  const c = paint(mode)
  return `${c.green(symbol.success)} ${text}`
}

export function warnLine(text: string, mode: OutputMode = 'pretty'): string {
  const c = paint(mode)
  return `${c.yellow(symbol.warn)} ${text}`
}

export function errorLine(text: string, mode: OutputMode = 'pretty'): string {
  const c = paint(mode)
  return `${c.red(symbol.error)} ${text}`
}

export function infoLine(text: string, mode: OutputMode = 'pretty'): string {
  const c = paint(mode)
  return `${c.cyan(symbol.info)} ${text}`
}

export function kv(
  label: string,
  value: string,
  mode: OutputMode = 'pretty',
): string {
  const c = paint(mode)
  return `${c.dim(label.padEnd(14))} ${value}`
}

export function heading(title: string, mode: OutputMode = 'pretty'): string {
  const c = paint(mode)
  return c.bold(title)
}

/** Strip global `--json` from argv. Returns [jsonEnabled, rest]. */
export function stripJsonFlag(argv: string[]): { json: boolean; argv: string[] } {
  const out: string[] = []
  let json = false
  for (const arg of argv) {
    if (arg === '--json') {
      json = true
      continue
    }
    out.push(arg)
  }
  return { json, argv: out }
}

export function createSpinner(
  text: string,
  mode: OutputMode,
): {
  start: (t?: string) => void
  succeed: (t?: string) => void
  fail: (t?: string) => void
  stop: () => void
  setText: (t: string) => void
} {
  if (mode !== 'pretty' || !process.stderr.isTTY) {
    return {
      start: () => {},
      succeed: () => {},
      fail: () => {},
      stop: () => {},
      setText: () => {},
    }
  }
  const spinner: Ora = ora({ text, stream: process.stderr })
  return {
    start: (t) => {
      if (t) spinner.text = t
      spinner.start()
    },
    succeed: (t) => spinner.succeed(t),
    fail: (t) => spinner.fail(t),
    stop: () => spinner.stop(),
    setText: (t) => {
      spinner.text = t
    },
  }
}

export function renderHelp(mode: OutputMode = 'pretty'): string {
  const c = paint(mode)
  const nl = '\n'
  const lines = [
    `${c.bold('zappi-cli')} ${c.dim('buyer CLI for Zappi agent pots')}`,
    c.dim('Run propose on the agent host so the pot key is created there.'),
    c.dim('In Zappi, the human only registers and funds.'),
    '',
    c.bold('Host setup'),
    `  ${c.cyan('propose')}   Create or register a pot on this host (wizard)`,
    '',
    c.bold('Agent spend'),
    c.dim('  After the pot is funded — the agent runs these, not the human launch.'),
    `  ${c.cyan('pay')}       Unlock a PaidResource (free pots)`,
    `  ${c.cyan('consume')}   Use more of a metered grant`,
    `  ${c.cyan('request')}   Auth-required: print one approve URL (no user code)`,
    '',
    c.bold('Options'),
    `  ${c.dim('--json')}              Machine-readable output (no colors)`,
    `  ${c.dim('--help, -h')}         Show help`,
    '',
    c.bold('Examples'),
    `  ${c.dim('zappi-cli propose')}`,
    `  ${c.dim('zappi-cli propose --generate --label Research --open')}`,
    `  ${c.dim('zappi-cli propose --address <pot-address> --ref <invite-code>')}`,
    `  ${c.dim('zappi-cli request --amount-cents 100 --to <spark-address>')}`,
    `  ${c.dim('zappi-cli pay <resourceId>')}`,
    `  ${c.dim('zappi-cli pay <resourceId> --no-consume')}`,
    `  ${c.dim('zappi-cli consume <resourceId> --units 1')}`,
    `  ${c.dim('zappi-cli pay <resourceId> --json')}`,
    '',
    c.bold('Env'),
    `  ${c.dim('ZAPPI_POT_ID')}         Pot id (required for pay and request)`,
    `  ${c.dim('ZAPPI_POT_CLIENT_TOKEN')}  zpc_ for request (host secret — never echo)`,
    `  ${c.dim('ZAPPI_POT_SEED')}       Pot key for free pay (host secret — never echo)`,
    `  ${c.dim('ZAPPI_POT_KEY_FILE')}   Fallback mode-0600 key file`,
    `  ${c.dim('ZAPPI_API_URL')}        Nest origin (default https://api.zappi.money)`,
    `  ${c.dim('ZAPPI_UNLOCK_TOKEN')}   Unlock bearer for consume`,
    `  ${c.dim('ZAPPI_POT_SPEND_MODE')}  free (default) or auth_required`,
    `  ${c.dim('ZAPPI_APP_ORIGIN')}     Web origin (default https://zappi.money)`,
    '',
    c.dim('Staging dogfood: set ZAPPI_API_URL and ZAPPI_APP_ORIGIN together.'),
    c.dim('Never print or log pot keys, pot client tokens, or unlock tokens.'),
  ]
  return lines.join(nl)
}
