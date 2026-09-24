import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { extractPhraseFromKeyFile } from './load-pot-seed.js'
import {
  defaultKeyFile,
  resolveKeyFilePath,
  writeKeyFile,
} from './pot-key-file.js'

const PHRASE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'

describe('resolveKeyFilePath', () => {
  it('keeps the suggested path when the answer is blank', () => {
    assert.equal(resolveKeyFilePath('  ', '/tmp/pot-research-1.txt'), '/tmp/pot-research-1.txt')
  })

  it('writes the suggested filename inside a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-key-'))
    try {
      assert.equal(
        resolveKeyFilePath(dir, '/tmp/pot-research-1.txt'),
        join(dir, 'pot-research-1.txt'),
      )
      assert.equal(
        resolveKeyFilePath(`${dir}/`, '/tmp/pot-research-1.txt'),
        join(dir, 'pot-research-1.txt'),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('writeKeyFile', () => {
  it('writes mode 0600 and a phrase loadPotSeed can read, without echoing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-key-'))
    const path = join(dir, 'pot.txt')
    try {
      writeKeyFile(path, PHRASE, 'spark1example', 'Research')
      const mode = statSync(path).mode & 0o777
      assert.equal(mode, 0o600)
      const text = readFileSync(path, 'utf8')
      assert.equal(extractPhraseFromKeyFile(text), PHRASE)
      assert.match(text, /Label: Research/)
      assert.match(text, /Wallet address: spark1example/)
      assert.equal(defaultKeyFile('Research').includes('pot-research-'), true)
      assert.equal(defaultKeyFile().includes('new-pot-'), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
