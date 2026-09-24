import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isProposeFullySpecified,
  parseProposeRegisterArgs,
  printRegisterDeepLink,
  runProposeRegister,
  wizardPresetsFromArgs,
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
    assert.equal(parsed.modeExplicit, true)
    assert.equal(parsed.originExplicit, false)
  })

  it('treats a full flag set as specified only when network is set too', () => {
    const argv = [
      '--generate',
      '--label',
      'Research',
      '--mode',
      'free',
      '--origin',
      'https://zappi.money',
    ]
    const parsed = parseProposeRegisterArgs(argv, {})
    assert.equal(parsed.originExplicit, true)
    assert.equal(isProposeFullySpecified(parsed, {}), false)
    assert.equal(isProposeFullySpecified(parsed, { SPARK_NETWORK: 'MAINNET' }), true)
    assert.equal(
      isProposeFullySpecified(parseProposeRegisterArgs(['--generate', '--label', 'Research', '--mode', 'free'], {}), {
        SPARK_NETWORK: 'MAINNET',
        NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      }),
      true,
    )
  })

  it('presets keep unset spend mode and origin so the wizard can ask', () => {
    const parsed = parseProposeRegisterArgs(
      ['--generate', '--label', 'Research', '--key-file', '/tmp/pot.txt'],
      { SPARK_NETWORK: 'REGTEST' },
    )
    const presets = wizardPresetsFromArgs(parsed, { SPARK_NETWORK: 'REGTEST' })
    assert.equal(presets.mode, 'generate')
    assert.equal(presets.label, 'Research')
    assert.equal(presets.keyFile, '/tmp/pot.txt')
    assert.equal(presets.spendMode, undefined)
    assert.equal(presets.origin, undefined)
    assert.equal(presets.sparkAddress, undefined)
  })

  it('non-TTY bare propose fails with flag usage', async () => {
    await assert.rejects(
      () => runProposeRegister([], {}, { isTTY: false }),
      /Interactive wizard needs a terminal/,
    )
  })

  it('TTY bare propose runs the wizard before generate', async () => {
    let argvSeen: string[] | undefined
    const output = await runProposeRegister([], {}, {
      isTTY: true,
      runWizard: async (argv) => {
        argvSeen = argv
        return {
          mode: 'generate',
          spendMode: 'free',
          label: 'pot_abc',
          network: 'MAINNET',
          origin: 'https://zappi.money',
          output: 'wizard-out',
        }
      },
    })
    assert.deepEqual(argvSeen, [])
    assert.equal(output, 'wizard-out')
  })

  it('TTY incomplete flags ask through the wizard and keep explicit answers', async () => {
    let presets: ReturnType<typeof wizardPresetsFromArgs> | undefined
    await runProposeRegister(
      ['--address', ADDRESS, '--mode', 'auth_required'],
      {},
      {
        isTTY: true,
        runWizard: async (_argv, _env, _deps, preset) => {
          presets = preset
          return {
            mode: 'existing',
            spendMode: 'auth_required',
            label: 'pot_abc',
            network: 'MAINNET',
            origin: 'https://zappi.money',
            output: 'asked',
          }
        },
      },
    )
    assert.equal(presets?.mode, 'existing')
    assert.equal(presets?.sparkAddress, ADDRESS)
    assert.equal(presets?.spendMode, 'auth_required')
    assert.equal(presets?.label, undefined)
    assert.equal(presets?.origin, undefined)
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
