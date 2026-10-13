#!/usr/bin/env node
/**
 * Published bin entry for `zappi-cli`.
 * Loads compiled CLI logic from dist/ (built by prepare/prepack).
 */
import { runCli, writeCliFailure } from '../dist/cli.js'
import { stripJsonFlag } from '../dist/ui.js'

const raw = process.argv.slice(2)

try {
  const { json, argv } = stripJsonFlag(raw)
  const mode = json ? 'json' : 'pretty'
  const output = await runCli(argv, mode)
  if (output !== '') process.stdout.write(`${output}\n`)
} catch (error) {
  const { json } = stripJsonFlag(raw)
  const mode = json ? 'json' : 'pretty'
  writeCliFailure(error, mode)
}
