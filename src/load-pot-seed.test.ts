import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { extractPhraseFromKeyFile, loadPotSeed } from './load-pot-seed.js'

const PLACEHOLDER_PHRASE = '<12-word pot phrase>'

describe('loadPotSeed', () => {
  it('reads ZAPPI_POT_SEED without requiring a file', () => {
    const phrase =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
    const loaded = loadPotSeed({ ZAPPI_POT_SEED: phrase })
    assert.equal(loaded, phrase)
  })

  it('rejects leftover placeholders so docs examples are not treated as secrets', () => {
    assert.throws(
      () => loadPotSeed({ ZAPPI_POT_SEED: PLACEHOLDER_PHRASE }),
      /placeholder/,
    )
  })

  it('reads the last phrase line from a key file and ignores labels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-pot-'))
    const path = join(dir, 'pot.txt')
    const phrase =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
    writeFileSync(
      path,
      [
        'Zappi agent pot key',
        'Label: Research',
        'Wallet address: spark1exampleaddress0000000000000000',
        '',
        'This file is the pot spend key. Store it as a host secret (ZAPPI_POT_SEED)',
        '',
        phrase,
        '',
      ].join('\n'),
    )
    const loaded = loadPotSeed({ ZAPPI_POT_KEY_FILE: path })
    assert.equal(loaded, phrase)
  })

  it('does not treat a missing env as a printable seed', () => {
    assert.throws(() => loadPotSeed({}), /Do not paste the pot key into chat/)
  })
})

describe('extractPhraseFromKeyFile', () => {
  it('returns null when no phrase line is present', () => {
    assert.equal(extractPhraseFromKeyFile('Label: Research\n'), null)
  })
})
