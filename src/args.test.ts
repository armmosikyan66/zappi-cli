import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseArgs, parseIntFlag } from './args.js'

describe('parseArgs', () => {
  it('parses --flag value pairs', () => {
    const parsed = parseArgs(['--asset', 'USDC', '--network', 'solana'])
    assert.deepEqual(parsed.positionals, [])
    assert.equal(parsed.strings.asset, 'USDC')
    assert.equal(parsed.strings.network, 'solana')
  })

  it('parses --flag=value form', () => {
    const parsed = parseArgs(['--asset=USDC', '--network=solana'])
    assert.equal(parsed.strings.asset, 'USDC')
    assert.equal(parsed.strings.network, 'solana')
  })

  it('treats a flag with no following value as boolean', () => {
    const parsed = parseArgs(['--create', '--json'])
    assert.equal(parsed.booleans.create, true)
    assert.equal(parsed.booleans.json, true)
  })

  it('collects positionals in order', () => {
    const parsed = parseArgs(['p1', '--flag', 'v', 'p2'])
    assert.deepEqual(parsed.positionals, ['p1', 'p2'])
  })

  it('stops collecting flags after --', () => {
    const parsed = parseArgs(['--', '--not-a-flag'])
    assert.deepEqual(parsed.positionals, ['--not-a-flag'])
  })
})

describe('parseIntFlag', () => {
  it('parses a positive integer', () => {
    assert.equal(parseIntFlag('100', 'amount'), 100)
  })

  it('throws on missing value', () => {
    assert.throws(() => parseIntFlag(undefined, 'amount'), /Missing --amount/)
  })

  it('throws on non-positive', () => {
    assert.throws(() => parseIntFlag('0', 'amount'), /positive integer/)
    assert.throws(() => parseIntFlag('-5', 'amount'), /positive integer/)
    assert.throws(() => parseIntFlag('1.5', 'amount'), /positive integer/)
  })
})
