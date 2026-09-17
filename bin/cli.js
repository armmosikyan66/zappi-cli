#!/usr/bin/env node
/**
 * Published bin entry for `zappi-cli`.
 * Loads compiled CLI logic from dist/ (built by prepare/prepack).
 */
import { runCli } from '../dist/cli.js'
import { stripJsonFlag } from '../dist/ui.js'
import { formatError } from '../dist/results.js'
import { redactSecrets } from '../dist/paywall-http.js'

try {
  const raw = process.argv.slice(2)
  const { json, argv } = stripJsonFlag(raw)
  const mode = json ? 'json' : 'pretty'
  const output = await runCli(argv, mode)
  process.stdout.write(`${output}\n`)
} catch (error) {
  const raw = process.argv.slice(2)
  const { json } = stripJsonFlag(raw)
  const mode = json ? 'json' : 'pretty'
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${formatError(redactSecrets(message), mode)}\n`)
  process.exitCode = 1
}
