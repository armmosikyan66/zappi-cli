import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { bech32m } from '@scure/base'
import {
  LABEL_CONFIRM_PROMPT,
  LOCAL_APP_ORIGIN,
  NETWORK_PROMPT,
  ORIGIN_PROMPT,
  runProposeWizard,
} from './propose-wizard.js'
import { generatePotLabel } from './wizard-io.js'

const ADDRESS =
  'spark1pgssyele0qrcjdheeq2a0zmpwdwvj3r4f4stkuju0fp36g6grapv2w7l8am2cp'

// Valid Bech32m regtest address (HRP sparkrt, 32-byte program).
const REGTEST_ADDRESS = bech32m.encode(
  'sparkrt',
  bech32m.toWords(new Uint8Array(32).fill(1)),
)

function makeDeps(overrides: Partial<Record<'ask' | 'select' | 'promptOpenLink', unknown>> = {}) {
  const prompts: string[] = []
  const deps = {
    ask: async (prompt: string) => {
      prompts.push(prompt)
      const answers = overrides.ask as string[] | undefined
      const answer = Array.isArray(answers) ? answers.shift() ?? '' : ''
      return answer
    },
    select: async (prompt: string, _options: unknown[]) => {
      prompts.push(prompt)
      const queued = overrides.select
      if (Array.isArray(queued)) {
        if (queued.length > 0) return String(queued.shift())
      } else if (typeof queued === 'string') {
        return queued
      }
      // Fallbacks when a test only queues mode + spend. Do not invent these in production.
      if (prompt === NETWORK_PROMPT || /Spark network/i.test(prompt)) return 'MAINNET'
      if (prompt === ORIGIN_PROMPT || /Zappi app/i.test(prompt)) return 'https://zappi.money'
      if (prompt === LABEL_CONFIRM_PROMPT || /That name is blank/i.test(prompt)) return 'auto'
      if (prompt.includes('spend') || prompt.includes('Auth')) return 'free'
      return 'generate'
    },
    promptOpenLink: async (href: string, options?: { openBrowser?: boolean; headline?: string }) => {
      prompts.push(href)
      prompts.push(`openBrowser:${options?.openBrowser !== false}`)
      return (overrides.promptOpenLink as { action: string; auto: boolean }) ?? { action: 'opened', auto: false }
    },
    generateMnemonic: () => 'test mnemonic words only for unit tests never use',
    deriveAddress: async (_mnemonic: string, _network: 'MAINNET' | 'REGTEST') => ADDRESS,
    writeKeyFile: (_path: string, _mnemonic: string, _address: string, _label?: string) => undefined,
    defaultKeyFile: (label?: string) => `/tmp/fake-pot-${label ?? 'x'}.txt`,
  }
  return { deps, prompts }
}

describe('generatePotLabel', () => {
  it('returns the trimmed answer when non-blank', () => {
    assert.equal(generatePotLabel('  Research  '), 'Research')
  })

  it('auto-generates pot_<unique> when blank', () => {
    const label = generatePotLabel('   ')
    assert.match(label, /^pot_[0-9a-f]{8}$/)
  })

  it('generates distinct labels', () => {
    assert.notEqual(generatePotLabel(), generatePotLabel())
  })
})

describe('runProposeWizard', () => {
  it('existing mode: asks address + label, validates, builds link, prompts auth', async () => {
    const { deps, prompts } = makeDeps({
      select: ['existing', 'free'],
      ask: [ADDRESS, 'Research'],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard([], { SPARK_NETWORK: 'MAINNET' }, deps)

    assert.equal(result.mode, 'existing')
    assert.equal(result.label, 'Research')
    assert.equal(result.sparkAddress, ADDRESS)
    assert.match(result.href!, new RegExp(ADDRESS))
    assert.match(result.href!, /label=Research/)
    assert.match(result.output, new RegExp(ADDRESS))
    assert.match(result.output, /Pot created successfully/)
    assert.equal(prompts.length >= 2, true)
    assert.ok(
      prompts.some((p) => p.includes('Do you already have a pot')),
      'mode prompt shown',
    )
    assert.ok(
      prompts.includes('openBrowser:true'),
      'free opens the register link',
    )
    assert.ok(
      prompts.some((p) => p.startsWith('http://') || p.startsWith('https://')),
      'register href shown',
    )
    assert.ok(prompts.some((p) => p.includes('Public pot address from your agent')))
    assert.ok(prompts.some((p) => p === 'How should this pot spend?'))
    const humanPrompts = prompts.filter(
      (p) => !p.startsWith('http') && !p.startsWith('openBrowser:'),
    )
    assert.ok(!humanPrompts.some((p) => /Bech32m|when you test it|spark1…|sparkrt1/i.test(p)))
  })

  it('puts a passed --ref on the register link and refuses a mnemonic', async () => {
    const { deps } = makeDeps({
      select: ['existing', 'free'],
      ask: [ADDRESS, 'Research'],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard(['--ref', 'abcd2345'], {}, deps)
    assert.match(result.href!, /ref=ABCD2345/)

    await assert.rejects(
      () =>
        runProposeWizard(
          [
            '--ref',
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
          ],
          {},
          deps,
        ),
      /recovery phrase/,
    )
  })

  it('existing mode: blank label confirms auto pot_<id> before register', async () => {
    const { deps, prompts } = makeDeps({
      select: ['existing', 'free', 'MAINNET', 'https://zappi.money', 'auto'],
      ask: [ADDRESS, ''],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard([], {}, deps)
    assert.match(result.label, /^pot_[0-9a-f]{8}$/)
    assert.match(result.href!, /label=pot_/)
    assert.ok(prompts.includes(LABEL_CONFIRM_PROMPT))
    assert.ok(result.output.includes('Sign in to Zappi and tap Register'))
    const confirmAt = prompts.indexOf(LABEL_CONFIRM_PROMPT)
    const hrefAt = prompts.findIndex((p) => p.startsWith('http'))
    assert.ok(confirmAt >= 0 && hrefAt > confirmAt)
  })

  it('existing mode: rejects a mnemonic as address and re-asks', async () => {
    const answers = [
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ADDRESS,
      'Research',
    ]
    const { deps } = makeDeps({
      select: ['existing', 'free'],
      ask: answers,
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard([], {}, deps)
    assert.equal(result.sparkAddress, ADDRESS)
  })

  it('existing mode: blank address cancels', async () => {
    const { deps } = makeDeps({
      select: ['existing', 'free'],
      ask: [''],
    })
    await assert.rejects(
      () => runProposeWizard([], {}, deps),
      /Cancelled/,
    )
  })

  it('generate mode: asks label then key file, writes 0600 key file, builds link', async () => {
    const written: Array<{ path: string; label?: string }> = []
    const { deps, prompts } = makeDeps({
      select: ['generate', 'free'],
      ask: ['Research', ''], // label, blank key-file → default suggested
    })
    deps.writeKeyFile = (path: string, _m: string, _a: string, label?: string) => {
      written.push({ path, label })
    }
    const result = await runProposeWizard([], {}, deps)

    assert.equal(result.mode, 'generate')
    assert.equal(result.label, 'Research')
    assert.equal(written.length, 1)
    assert.equal(written[0].label, 'Research')
    assert.match(written[0].path, /fake-pot-Research/)
    assert.match(result.output, /Pot created successfully/)
    assert.match(result.output, /Disconnect cannot stop on-chain spend/)
    assert.match(result.output, /fake-pot-Research/)
    assert.ok(!result.output.includes('test mnemonic words'))
    assert.match(result.href!, /https:\/\/zappi\.money\//)
    assert.ok(
      prompts.some((p) => p.startsWith('Pot key file')),
      'key-file prompt does not say mnemonic',
    )
    assert.ok(!prompts.some((p) => /mnemonic/i.test(p)))
  })

  it('generate mode: a directory answer writes the suggested filename inside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-wiz-'))
    const written: string[] = []
    const { deps } = makeDeps({
      select: ['generate', 'free'],
      ask: ['Research', dir],
    })
    deps.defaultKeyFile = () => '/tmp/pot-research-1.txt'
    deps.writeKeyFile = (path: string) => {
      written.push(path)
    }
    try {
      const result = await runProposeWizard([], {}, deps)
      assert.equal(written[0], join(dir, 'pot-research-1.txt'))
      assert.equal(result.keyFile, join(dir, 'pot-research-1.txt'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('generate mode: blank label confirms auto pot_<id> and names the key file', async () => {
    const written: Array<{ path: string; label?: string }> = []
    const events: string[] = []
    const { deps, prompts } = makeDeps({
      select: ['generate', 'free', 'MAINNET', 'https://zappi.money', 'auto'],
      ask: ['', ''],
    })
    deps.generateMnemonic = () => {
      events.push(`prompts:${prompts.length}`)
      return 'test mnemonic words only for unit tests never use'
    }
    deps.writeKeyFile = (path: string, _m: string, _a: string, label?: string) => {
      written.push({ path, label })
    }
    const result = await runProposeWizard([], {}, deps)
    assert.match(result.label, /^pot_[0-9a-f]{8}$/)
    assert.match(written[0].path, /fake-pot-pot_/)
    assert.ok(prompts.includes(LABEL_CONFIRM_PROMPT))
    assert.ok(prompts.includes(NETWORK_PROMPT))
    assert.ok(prompts.includes(ORIGIN_PROMPT))
    assert.match(events[0], /^prompts:/)
    const seen = Number(events[0].slice('prompts:'.length))
    assert.ok(seen > prompts.indexOf(ORIGIN_PROMPT))
    assert.ok(seen > prompts.indexOf(LABEL_CONFIRM_PROMPT))
  })

  it('mode from argv skips the mode question (existing)', async () => {
    const { deps, prompts } = makeDeps({
      select: ['free'],
      ask: [ADDRESS, 'Research'],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard(['existing'], {}, deps)
    assert.equal(result.mode, 'existing')
    assert.ok(
      !prompts.some((p) => p.includes('Do you already have a pot')),
      'mode prompt skipped',
    )
  })

  it('mode from argv skips the mode question (generate)', async () => {
    const { deps, prompts } = makeDeps({
      ask: ['Research', ''],
    })
    const result = await runProposeWizard(['generate'], {}, deps)
    assert.equal(result.mode, 'generate')
    assert.ok(
      !prompts.some((p) => p.includes('Do you already have a pot')),
      'mode prompt skipped',
    )
  })

  it('auth_required tab sets mode=auth_required and pots=mine on the link', async () => {
    const { deps } = makeDeps({
      select: ['existing', 'auth_required'],
      ask: [ADDRESS, 'Research'],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard([], { SPARK_NETWORK: 'MAINNET' }, deps)
    assert.equal(result.spendMode, 'auth_required')
    assert.match(result.href!, /mode=auth_required/)
    assert.match(result.href!, /pots=mine/)
    assert.match(result.output, /auth required/)
  })

  it('free tab sets mode=free and pots=agent on the link', async () => {
    const { deps, prompts } = makeDeps({
      select: ['generate', 'free'],
      ask: ['Research', ''],
    })
    const result = await runProposeWizard([], {}, deps)
    assert.equal(result.spendMode, 'free')
    assert.match(result.href!, /mode=free/)
    assert.match(result.href!, /pots=agent/)
    assert.match(result.output, /Pot created successfully/)
    assert.equal(result.openResult?.action, 'opened')
    assert.ok(
      prompts.includes('openBrowser:true'),
      'free must open the register link',
    )
  })

  it('auth_required tab opens the browser', async () => {
    const { deps, prompts } = makeDeps({
      select: ['existing', 'auth_required'],
      ask: [ADDRESS, 'Research'],
      promptOpenLink: { action: 'opened', auto: true },
    })
    await runProposeWizard([], { SPARK_NETWORK: 'MAINNET' }, deps)
    assert.ok(
      prompts.includes('openBrowser:true'),
      'auth_required must open the browser',
    )
  })

  it('copied action notes the clipboard', async () => {
    const { deps } = makeDeps({
      select: ['existing', 'auth_required'],
      ask: [ADDRESS, 'Research'],
      promptOpenLink: { action: 'copied', auto: false },
    })
    const result = await runProposeWizard([], { SPARK_NETWORK: 'MAINNET' }, deps)
    assert.match(result.output, /Link copied to clipboard/)
  })

  it('respects ZAPPI_APP_ORIGIN and REGTEST network without prompting', async () => {
    const { deps, prompts } = makeDeps({
      select: ['existing', 'free'],
      ask: [REGTEST_ADDRESS, 'Dev'],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard(
      [],
      { ZAPPI_APP_ORIGIN: 'https://dev.zappi.money', SPARK_NETWORK: 'REGTEST' },
      deps,
    )
    assert.match(result.href!, /https:\/\/dev\.zappi\.money\//)
    assert.equal(result.network, 'REGTEST')
    assert.ok(!prompts.includes(NETWORK_PROMPT))
    assert.ok(!prompts.includes(ORIGIN_PROMPT))
  })

  it('rejects a mainnet address when network is REGTEST', async () => {
    const answers = [ADDRESS, ADDRESS, ADDRESS, ADDRESS, ADDRESS, ADDRESS]
    const { deps } = makeDeps({ select: ['existing', 'free'], ask: answers })
    await assert.rejects(
      () => runProposeWizard([], { SPARK_NETWORK: 'REGTEST' }, deps),
      /Cancelled/,
    )
  })

  it('asks network and origin before generate when env is unset', async () => {
    const events: string[] = []
    const { deps, prompts } = makeDeps({
      select: ['generate', 'free', 'REGTEST', LOCAL_APP_ORIGIN, 'auto'],
      ask: ['', ''],
    })
    deps.generateMnemonic = () => {
      events.push('generate')
      return 'test mnemonic words only for unit tests never use'
    }
    deps.deriveAddress = async (_mnemonic: string, network: 'MAINNET' | 'REGTEST') => {
      events.push(`derive:${network}`)
      return REGTEST_ADDRESS
    }
    const result = await runProposeWizard([], {}, deps)
    assert.deepEqual(events, ['generate', 'derive:REGTEST'])
    assert.equal(result.network, 'REGTEST')
    assert.equal(result.origin, LOCAL_APP_ORIGIN)
    assert.match(result.href!, /^http:\/\/localhost:3000\//)
    assert.match(result.label, /^pot_[0-9a-f]{8}$/)
    assert.ok(prompts.indexOf(NETWORK_PROMPT) < prompts.indexOf(ORIGIN_PROMPT))
    assert.ok(prompts.indexOf(ORIGIN_PROMPT) < prompts.indexOf(LABEL_CONFIRM_PROMPT))
    assert.ok(!result.output.includes('test mnemonic words'))
  })

  it('prompts for network when SPARK_NETWORK is blank', async () => {
    const { deps, prompts } = makeDeps({
      select: ['generate', 'free', 'MAINNET', 'https://zappi.money'],
      ask: ['Research', ''],
    })
    const result = await runProposeWizard([], { SPARK_NETWORK: '   ' }, deps)
    assert.ok(prompts.includes(NETWORK_PROMPT))
    assert.equal(result.network, 'MAINNET')
  })

  it('skips the origin prompt when NEXT_PUBLIC_SITE_URL is set', async () => {
    const { deps, prompts } = makeDeps({
      select: ['existing', 'free', 'MAINNET'],
      ask: [ADDRESS, 'Research'],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard(
      [],
      { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000/app' },
      deps,
    )
    assert.ok(prompts.includes(NETWORK_PROMPT))
    assert.ok(!prompts.includes(ORIGIN_PROMPT))
    assert.equal(result.origin, 'http://localhost:3000')
    assert.match(result.href!, /^http:\/\/localhost:3000\//)
  })

  it('uses a custom origin after an invalid entry', async () => {
    const { deps, prompts } = makeDeps({
      select: ['existing', 'free', 'MAINNET', 'custom'],
      ask: ['notaurl', 'http://127.0.0.1:4000/pots', ADDRESS, 'Lab'],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard([], {}, deps)
    assert.equal(result.origin, 'http://127.0.0.1:4000')
    assert.match(result.href!, /^http:\/\/127\.0\.0\.1:4000\//)
    assert.ok(prompts.includes(ORIGIN_PROMPT))
    assert.ok(prompts.some((p) => p.startsWith('Custom app origin')))
  })

  it('cancels a blank custom origin with guidance', async () => {
    const { deps } = makeDeps({
      select: ['existing', 'free', 'MAINNET', 'custom'],
      ask: [''],
    })
    await assert.rejects(
      () => runProposeWizard([], {}, deps),
      /Cancelled — no app origin/,
    )
  })

  it('refuses an unknown network instead of inventing MAINNET', async () => {
    const { deps } = makeDeps({
      select: ['generate', 'free', 'testnet'],
    })
    await assert.rejects(
      () => runProposeWizard([], {}, deps),
      /Choose MAINNET or REGTEST/,
    )
  })

  it('blank label then custom name uses the typed name', async () => {
    const { deps, prompts } = makeDeps({
      select: ['generate', 'free', 'MAINNET', 'https://zappi.money', 'custom'],
      ask: ['', 'Research', ''],
    })
    const result = await runProposeWizard([], {}, deps)
    assert.equal(result.label, 'Research')
    assert.ok(prompts.includes(LABEL_CONFIRM_PROMPT))
    assert.ok(prompts.some((p) => p.startsWith('Custom pot name')))
  })

  it('a blank custom name accepts auto pot_<unique>', async () => {
    const { deps } = makeDeps({
      select: ['generate', 'free', 'MAINNET', 'https://zappi.money', 'custom'],
      ask: ['   ', '', ''],
    })
    const result = await runProposeWizard([], {}, deps)
    assert.match(result.label, /^pot_[0-9a-f]{8}$/)
  })

  it('a typed label skips the auto-name confirm', async () => {
    const { deps, prompts } = makeDeps({
      select: ['generate', 'free'],
      ask: ['Research', ''],
    })
    await runProposeWizard([], {}, deps)
    assert.ok(!prompts.includes(LABEL_CONFIRM_PROMPT))
  })

  it('presets skip questions flags already answered', async () => {
    const { deps, prompts } = makeDeps({
      select: ['REGTEST'],
      ask: [''],
    })
    deps.deriveAddress = async () => REGTEST_ADDRESS
    const result = await runProposeWizard([], {}, deps, {
      mode: 'generate',
      spendMode: 'free',
      label: 'Research',
      origin: 'http://localhost:3000',
    })
    assert.equal(result.mode, 'generate')
    assert.equal(result.label, 'Research')
    assert.equal(result.network, 'REGTEST')
    assert.equal(result.origin, 'http://localhost:3000')
    assert.ok(!prompts.some((p) => p.includes('Do you already have a pot')))
    assert.ok(!prompts.some((p) => p === 'How should this pot spend?'))
    assert.ok(!prompts.includes(ORIGIN_PROMPT))
    assert.ok(!prompts.includes(LABEL_CONFIRM_PROMPT))
    assert.ok(prompts.includes(NETWORK_PROMPT))
    assert.ok(prompts.some((p) => p.startsWith('Pot key file')))
  })

  it('rejects a preset origin that is not http(s)', async () => {
    const { deps } = makeDeps({
      select: [],
      ask: [],
    })
    await assert.rejects(
      () =>
        runProposeWizard([], { SPARK_NETWORK: 'MAINNET' }, deps, {
          mode: 'existing',
          spendMode: 'free',
          label: 'Research',
          sparkAddress: ADDRESS,
          origin: 'ftp://files.example',
        }),
      /http\(s\) URL/,
    )
  })
})
