#!/usr/bin/env node
/**
 * Published bin entry for `zappi-pot`.
 * Loads compiled CLI logic from dist/ (built by prepare/prepack).
 */
import { runCli } from '../dist/cli.js'
import { redactSecrets } from '../dist/paywall-http.js'

try {
  const output = await runCli(process.argv.slice(2))
  process.stdout.write(`${output}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${redactSecrets(message)}\n`)
  process.exitCode = 1
}
