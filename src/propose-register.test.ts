import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseProposeRegisterArgs,
  printRegisterDeepLink,
} from './propose-register.js'
import { renderHelp } from './ui.js'

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

  it('defaults origin to production web', () => {
    const parsed = parseProposeRegisterArgs(['--generate'], {})
    assert.equal(parsed.origin, 'https://zappi.money')
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

  it('reads a Crockford --ref and does not invent one', () => {
    const parsed = parseProposeRegisterArgs(
      ['--address', ADDRESS, '--ref', 'abcd2345'],
      {},
    )
    assert.equal(parsed.ref, 'ABCD2345')
  })

  it('refuses a recovery phrase as --ref', () => {
    assert.throws(
      () => parseProposeRegisterArgs(['--address', ADDRESS, '--ref', MNEMONIC], {}),
      /recovery phrase/,
    )
  })

  it('refuses a --ref that is not an invite code', () => {
    assert.throws(
      () => parseProposeRegisterArgs(['--address', ADDRESS, '--ref', 'not a code'], {}),
      /does not invent one/,
    )
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
    assert.doesNotMatch(printed, /[?&]ref=/)
  })

  it('prints ref on the register link when the caller passes a code', () => {
    const printed = printRegisterDeepLink({
      sparkAddress: ADDRESS,
      origin: 'https://zappi.money',
      ref: 'ABCD2345',
    })
    assert.match(printed, /ref=ABCD2345/)
    assert.doesNotMatch(printed, /abandon/)
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

describe('renderHelp', () => {
  it('splits host setup from agent spend and names matching production defaults', () => {
    const help = renderHelp('plain')
    assert.match(help, /Host setup/)
    assert.match(help, /Agent spend/)
    assert.match(help, /agent host/)
    assert.match(help, /ZAPPI_APP_ORIGIN.*https:\/\/zappi\.money/)
    assert.match(help, /ZAPPI_API_URL.*https:\/\/api\.zappi\.money/)
    assert.doesNotMatch(help, /402 → settle/)
    assert.doesNotMatch(help, /Bech32m|spark1|Spark/)
    assert.match(help, /Staging dogfood: set ZAPPI_API_URL and ZAPPI_APP_ORIGIN together/)
  })
})
