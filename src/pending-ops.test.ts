import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  beginOperation,
  capsEnabled,
  journalPath,
  markFailed,
  markSettled,
  recordSubmitted,
  resolveCapsConfig,
  validateJournalFile,
} from './pending-ops.js'
import type { MoneyOutIntent } from './pot-outgate.js'

function payIntent(overrides: Partial<MoneyOutIntent> = {}): MoneyOutIntent {
  return {
    kind: 'pay',
    potId: 'pot_1',
    sourceAddress: 'spark1src',
    receiver: 'spark1payto',
    amountCents: 25,
    asset: 'USDB',
    network: 'REGTEST',
    resourceId: 'res_1',
    ...overrides,
  }
}

function tmpJournal(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zappi-journal-'))
  return join(dir, 'pending-ops.json')
}

describe('resolveCapsConfig + capsEnabled', () => {
  it('reads positive integer caps and treats unset as disabled', () => {
    assert.equal(capsEnabled(resolveCapsConfig({})), false)
    const cfg = resolveCapsConfig({
      ZAPPI_POT_MAX_PER_PAYMENT_CENTS: '1000',
      ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H: '5000',
    })
    assert.equal(cfg.maxPerPayment, 1000)
    assert.equal(cfg.maxCumulative24h, 5000)
    assert.equal(capsEnabled(cfg), true)
  })

  it('rejects non-positive / non-integer cap values', () => {
    assert.throws(() => resolveCapsConfig({ ZAPPI_POT_MAX_PER_PAYMENT_CENTS: '0' }), /positive integer/)
    assert.throws(() => resolveCapsConfig({ ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H: '1.5' }), /positive integer/)
  })
})

describe('validateJournalFile', () => {
  it('rejects an unknown version', () => {
    assert.throws(
      () => validateJournalFile({ version: 2, ops: {} }),
      /unsupported/,
    )
  })

  it('rejects a prototype-pollution op key', () => {
    const bad = JSON.parse('{"version":1,"ops":{"__proto__":{"idempotencyKey":"__proto__","intentHash":"h","kind":"pay","potId":"p","receiver":"r","amountCents":1,"asset":"USDB","network":"REGTEST","status":"pending","createdAt":"t","updatedAt":"t"}}}')
    assert.throws(() => validateJournalFile(bad), /reserved/)
  })

  it('rejects a dictionary key that does not equal idempotencyKey', () => {
    assert.throws(
      () => validateJournalFile({ version: 1, ops: { k1: { idempotencyKey: 'other', intentHash: 'h', kind: 'pay', potId: 'p', receiver: 'r', amountCents: 1, asset: 'USDB', network: 'REGTEST', status: 'pending', createdAt: 't', updatedAt: 't' } } }),
      /must equal idempotencyKey/,
    )
  })
})

describe('beginOperation + recordSubmitted + markSettled', () => {
  it('creates a pending op on first call (sign) and reconciles on replay', async () => {
    const path = tmpJournal()
    const deps = { path, env: {}, now: () => new Date('2026-01-01T00:00:00Z') }
    const first = await beginOperation(payIntent(), 'key-1', deps)
    assert.equal(first.action, 'sign')
    assert.equal(first.op.status, 'pending')

    // After signing, record the tx hash → submitted.
    await recordSubmitted('key-1', 'aa'.repeat(32), deps)

    // A replay (crash before settle) reconciles with the existing tx hash, no re-sign.
    const replay = await beginOperation(payIntent(), 'key-1', deps)
    assert.equal(replay.action, 'reconcile')
    assert.equal(replay.op.status, 'submitted')
    assert.equal(replay.op.sparkTxHash, 'aa'.repeat(32))

    await markSettled('key-1', deps)
    const done = await beginOperation(payIntent(), 'key-1', deps)
    assert.equal(done.action, 'done')
    assert.equal(done.op.status, 'settled')
    rmSync(join(path, '..'), { recursive: true, force: true })
  })

  it('a pending op with no tx hash fails closed (unknown) on replay', async () => {
    const path = tmpJournal()
    const deps = { path, env: {}, now: () => new Date('2026-01-01T00:00:00Z') }
    await beginOperation(payIntent(), 'key-2', deps)
    // crash before recordSubmitted → op stays pending with no tx hash
    const replay = await beginOperation(payIntent(), 'key-2', deps)
    assert.equal(replay.action, 'unknown')
    assert.equal(replay.op.status, 'pending')
    assert.equal(replay.op.sparkTxHash, undefined)
    rmSync(join(path, '..'), { recursive: true, force: true })
  })

  it('a failed op allows a fresh sign attempt', async () => {
    const path = tmpJournal()
    const deps = { path, env: {}, now: () => new Date('2026-01-01T00:00:00Z') }
    await beginOperation(payIntent(), 'key-3', deps)
    await markFailed('key-3', 'settle 500', deps)
    const retry = await beginOperation(payIntent(), 'key-3', deps)
    assert.equal(retry.action, 'sign')
    assert.equal(retry.op.status, 'pending')
    rmSync(join(path, '..'), { recursive: true, force: true })
  })
})

describe('caps enforcement', () => {
  it('rejects a payment exceeding the per-payment cap before signing', async () => {
    const path = tmpJournal()
    const deps = { path, env: { ZAPPI_POT_MAX_PER_PAYMENT_CENTS: '50' }, now: () => new Date('2026-01-01T00:00:00Z') }
    await assert.rejects(
      () => beginOperation(payIntent({ amountCents: 51 }), 'key-cap-1', deps),
      /exceeds the per-payment cap/,
    )
    // Under cap is allowed.
    const ok = await beginOperation(payIntent({ amountCents: 50 }), 'key-cap-1b', deps)
    assert.equal(ok.action, 'sign')
    rmSync(join(path, '..'), { recursive: true, force: true })
  })

  it('rejects a payment exceeding the cumulative 24h cap (counts submitted + settled)', async () => {
    const path = tmpJournal()
    const t0 = '2026-01-01T00:00:00Z'
    const deps = { path, env: { ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H: '100' }, now: () => new Date(t0) }
    // First op: 60¢ submitted.
    await beginOperation(payIntent({ amountCents: 60 }), 'key-cum-1', deps)
    await recordSubmitted('key-cum-1', 'aa'.repeat(32), deps)
    // Second op: 50¢ → total 110¢ > 100 → reject.
    await assert.rejects(
      () => beginOperation(payIntent({ amountCents: 50 }), 'key-cum-2', deps),
      /Cumulative money-out.*exceed the cap/)
    rmSync(join(path, '..'), { recursive: true, force: true })
  })

  it('cumulative window excludes ops older than 24h', async () => {
    const path = tmpJournal()
    let now = new Date('2026-01-01T00:00:00Z')
    const deps = { path, env: { ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H: '100' }, now: () => now }
    await beginOperation(payIntent({ amountCents: 60 }), 'key-win-1', deps)
    await recordSubmitted('key-win-1', 'aa'.repeat(32), deps)
    // 25h later → old op falls outside the window.
    now = new Date('2026-01-02T01:00:00Z')
    const ok = await beginOperation(payIntent({ amountCents: 50 }), 'key-win-2', deps)
    assert.equal(ok.action, 'sign')
    rmSync(join(path, '..'), { recursive: true, force: true })
  })
})

describe('journal file safety', () => {
  it('refuses a journal file other users can read', async () => {
    const path = tmpJournal()
    writeFileSync(path, JSON.stringify({ version: 1, ops: {} }), { mode: 0o600 })
    chmodSync(path, 0o644)
    await assert.rejects(
      () => beginOperation(payIntent(), 'key-perm', { path, env: {}, now: () => new Date('2026-01-01T00:00:00Z') }),
      /other users can read\/write it/,
    )
    rmSync(join(path, '..'), { recursive: true, force: true })
  })

  it('refuses a symlink journal file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-journal-sym-'))
    const real = join(dir, 'real.json')
    writeFileSync(real, JSON.stringify({ version: 1, ops: {} }), { mode: 0o600 })
    const sym = join(dir, 'sym.json')
    try { symlinkSync(real, sym) } catch { /* skip on platforms w/o symlinks */ }
    await assert.rejects(
      () => beginOperation(payIntent(), 'key-sym', { path: sym, env: {}, now: () => new Date('2026-01-01T00:00:00Z') }),
      /symlink/,
    )
    rmSync(dir, { recursive: true, force: true })
  })
})
