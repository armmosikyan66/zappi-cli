import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseProposeRegisterArgs,
  printRegisterDeepLink,
} from './propose-register.js'

const ADDRESS =
  'spark1pgssyele0qrcjdheeq2a0zmpwdwvj3r4f4stkuju0fp36g6grapv2w7l8am2cp'
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('parseProposeRegisterArgs', () => {
  it('reads address, label, origin, and flags', () => {
    const parsed = parseProposeRegisterArgs(
      [
        '--address',
        ADDRESS,
        '--label',
        'Research',
        '--origin',
        'https://dev.zappi.money',
        '--open',
      ],
      {},
    )
    assert.equal(parsed.address, ADDRESS)
    assert.equal(parsed.label, 'Research')
    assert.equal(parsed.origin, 'https://dev.zappi.money')
    assert.equal(parsed.open, true)
    assert.equal(parsed.generate, false)
  })

  it('defaults origin to local / staging web', () => {
    const parsed = parseProposeRegisterArgs(['--generate'], {})
    assert.equal(parsed.origin, 'http://dev.zappi.money')
    assert.equal(parsed.generate, true)
    assert.equal(parsed.mode, 'free')
  })

  it('reads --mode auth_required', () => {
    const parsed = parseProposeRegisterArgs(
      ['--generate', '--mode', 'auth_required'],
      {},
    )
    assert.equal(parsed.mode, 'auth_required')
  })
})

describe('printRegisterDeepLink', () => {
  it('prints the public address and deep link without a mnemonic', () => {
    const printed = printRegisterDeepLink({
      sparkAddress: ADDRESS,
      label: 'Research',
      origin: 'https://zappi.money',
    })
    assert.match(printed, new RegExp(ADDRESS))
    assert.match(printed, /panel=pots/)
    assert.match(printed, /mode=free/)
    assert.match(printed, /pots=agent/)
    assert.match(printed, /register=/)
    assert.match(printed, /label=Research/)
    assert.doesNotMatch(printed, /abandon/)
    assert.match(printed, /Never print/)
    assert.doesNotMatch(printed, /--pot/)
  })

  it('refuses a recovery phrase as --address', () => {
    assert.throws(
      () => printRegisterDeepLink({ sparkAddress: MNEMONIC }),
      /recovery phrase/,
    )
  })

  it('prints auth_required mode when requested', () => {
    const printed = printRegisterDeepLink({
      sparkAddress: ADDRESS,
      label: 'Research',
      origin: 'https://zappi.money',
      mode: 'auth_required',
    })
    assert.match(printed, /mode=auth_required/)
    assert.match(printed, /pots=mine/)
  })
})
