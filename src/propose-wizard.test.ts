import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { bech32m } from '@scure/base'
import { runProposeWizard } from './propose-wizard.js'
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
    select: async (_prompt: string, _options: unknown[]) => {
      prompts.push(_prompt)
      const queued = overrides.select
      if (Array.isArray(queued)) {
        return String(queued.shift() ?? 'free')
      }
      if (typeof queued === 'string') return queued
      // Default: generate for pot-mode prompt, free for auth-mode prompt
      if (_prompt.includes('spend') || _prompt.includes('Auth')) return 'free'
      return 'generate'
    },
    promptOpenLink: async (href: string) => {
      prompts.push(href)
      return (overrides.promptOpenLink as { action: string; auto: boolean }) ?? { action: 'opened', auto: false }
    },
    generateMnemonic: () => 'test mnemonic words only for unit tests never use',
    deriveAddress: async () => ADDRESS,
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
    // Mode was asked (argv empty) and auth prompt ran with the link
    assert.equal(prompts.length >= 2, true)
    assert.ok(
      prompts.some((p) => p.includes('Do you already have a pot')),
      'mode prompt shown',
    )
    assert.ok(
      prompts.some((p) => p.startsWith('http://') || p.startsWith('https://')),
      'auth prompt got the link',
    )
  })

  it('existing mode: blank label auto-generates pot_<id>', async () => {
    const { deps } = makeDeps({
      select: ['existing', 'free'],
      ask: [ADDRESS, ''],
      promptOpenLink: { action: 'opened', auto: false },
    })
    const result = await runProposeWizard([], {}, deps)
    assert.match(result.label, /^pot_[0-9a-f]{8}$/)
    assert.match(result.href!, /label=pot_/)
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
    const { deps } = makeDeps({
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
    assert.match(result.output, /Key file written/)
    assert.match(result.output, /fake-pot-Research/)
    assert.ok(!result.output.includes('test mnemonic words'))
    assert.match(result.href!, /http:\/\/dev\.zappi\.money\//)
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

  it('generate mode: blank label auto-generates pot_<id> and names the key file', async () => {
    const written: Array<{ path: string; label?: string }> = []
    const { deps } = makeDeps({
      select: ['generate', 'free'],
      ask: ['', ''],
    })
    deps.writeKeyFile = (path: string, _m: string, _a: string, label?: string) => {
      written.push({ path, label })
    }
    const result = await runProposeWizard([], {}, deps)
    assert.match(result.label, /^pot_[0-9a-f]{8}$/)
    assert.match(written[0].path, /fake-pot-pot_/)
  })

  it('mode from argv skips the mode question (existing)', async () => {
    const { deps, prompts } = makeDeps({
      select: ['existing', 'free'],
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
    const { deps } = makeDeps({
      select: ['generate', 'free'],
      ask: ['Research', ''],
    })
    const result = await runProposeWizard([], {}, deps)
    assert.equal(result.spendMode, 'free')
    assert.match(result.href!, /mode=free/)
    assert.match(result.href!, /pots=agent/)
  })

  it('copied action notes the clipboard', async () => {
    const { deps } = makeDeps({
      select: ['existing', 'free'],
      ask: [ADDRESS, 'Research'],
      promptOpenLink: { action: 'copied', auto: false },
    })
    const result = await runProposeWizard([], {}, deps)
    assert.match(result.output, /Link copied to clipboard/)
  })

  it('respects ZAPPI_APP_ORIGIN and REGTEST network', async () => {
    const { deps } = makeDeps({
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
  })

  it('rejects a mainnet address when network is REGTEST', async () => {
    const answers = [ADDRESS, ADDRESS, ADDRESS, ADDRESS, ADDRESS, ADDRESS]
    const { deps } = makeDeps({ select: ['existing', 'free'], ask: answers })
    await assert.rejects(
      () => runProposeWizard([], { SPARK_NETWORK: 'REGTEST' }, deps),
      /Cancelled/,
    )
  })
})
