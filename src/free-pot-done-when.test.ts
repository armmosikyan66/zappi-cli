/**
 * Cross-cutting done-when gate for Linear 1-456 / 1-462.
 *
 * The stage tests already cover the bulk of the matrix (registry, context,
 * ops, outgate, journal). This file pins the remaining combinations the
 * parent Done-when checklist names explicitly: registry identity survives
 * rotation and a stale-backup restore; the context carries the stored
 * account index and network (no silent migration); concurrent money-out
 * attempts serialize under the cumulative cap; an auth-required context
 * never reaches the free Spark signer; and secret paths stay redacted.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { bech32m } from '@scure/base'
import { resolvePotContext } from './pot-context.js'
import { loadPotSeedFromRegistry, savePotSeed } from './pot-registry.js'
import { reseedAll } from './pot-registry-rotate.js'
import {
  runPotsRegistryBackup,
  runPotsRegistryRestore,
} from './pots-registry-commands.js'
import { beginOperation } from './pending-ops.js'
import { runSendSparkUsdb } from './send-commands.js'
import { redactSecrets } from './paywall-http.js'
import type { MoneyOutIntent } from './pot-outgate.js'
import type { PotContext } from './pot-context.js'

const here = dirname(fileURLToPath(import.meta.url))
const PHRASE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
const PASSPHRASE = 'a-very-long-high-entropy-host-secret-passphrase-0123456789'
const ADDRESS_A = 'spark1originalidentity000000000000000'
const ADDRESS_B = 'spark1replacedidentity000000000000000'
const REGTEST_ADDR = bech32m.encode('spark', bech32m.toWords(new Uint8Array(32).fill(1)))

function envFor(dir: string) {
  return {
    ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
    ZAPPI_API_URL: 'https://api.test.zappi.money',
    ZAPPI_APP_ORIGIN: 'https://app.test.zappi.money',
    ZAPPI_POT_PASSPHRASE: PASSPHRASE,
  }
}

function input(potId: string, sparkAddress: string, accountIndex = 1) {
  return {
    potId,
    label: 'Research',
    sparkAddress,
    spendMode: 'free' as const,
    network: 'MAINNET' as const,
    derivationMode: 'spark' as const,
    accountIndex,
    seed: PHRASE,
  }
}

describe('1-462 identity survives rotation and stale-backup restore', () => {
  it('rotation keeps the original Spark address and account index', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-dw-rotate-'))
    const env = envFor(dir)
    const path = env.ZAPPI_POT_REGISTRY_FILE
    try {
      await savePotSeed(input('pot_a', ADDRESS_A), PASSPHRASE, { env })
      const next = 'rotated-passphrase-at-least-16'
      await reseedAll(path, PASSPHRASE, next, { env })
      const loaded = await loadPotSeedFromRegistry('pot_a', next, {
        env: { ...env, ZAPPI_POT_PASSPHRASE: next },
      })
      assert.equal(loaded.record.sparkAddress, ADDRESS_A)
      assert.equal(loaded.record.accountIndex, 1)
      assert.equal(loaded.record.network, 'MAINNET')
      assert.equal(loaded.seed, PHRASE)
      assert.equal(readFileSync(path, 'utf8').includes(PHRASE), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('restoring a stale backup brings back the original Spark identity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-dw-backup-'))
    const env = envFor(dir)
    const backup = join(dir, 'backup.json')
    try {
      await savePotSeed(input('pot_a', ADDRESS_A), PASSPHRASE, { env })
      await runPotsRegistryBackup([backup], 'plain', { env })
      await savePotSeed(input('pot_a', ADDRESS_B), PASSPHRASE, { env })
      const replaced = await loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env })
      assert.equal(replaced.record.sparkAddress, ADDRESS_B)

      await runPotsRegistryRestore([backup], 'plain', {
        env,
        deriveAddress: async () => ADDRESS_A,
      })
      const restored = await loadPotSeedFromRegistry('pot_a', PASSPHRASE, { env })
      assert.equal(restored.record.sparkAddress, ADDRESS_A)
      assert.equal(restored.seed, PHRASE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-462 context does not silently migrate derivation', () => {
  it('carries the stored account index and network, ignoring SPARK_NETWORK', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-dw-ctx-'))
    const env = { ...envFor(dir), SPARK_NETWORK: 'MAINNET' }
    const seen: number[] = []
    try {
      await savePotSeed(input('pot_a', ADDRESS_A), PASSPHRASE, { env })
      const ctx = await resolvePotContext(
        { potFlag: 'pot_a' },
        {
          env,
          deriveAddress: async (_seed, network, accountIndex) => {
            seen.push(accountIndex)
            assert.equal(network, 'MAINNET')
            return ADDRESS_A
          },
        },
      )
      assert.deepEqual(seen, [1])
      assert.equal(ctx.accountIndex, 1)
      assert.equal(ctx.network, 'MAINNET')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('1-462 concurrent caps and auth-required boundary', () => {
  it('serializes concurrent money-out so only one fits under the cumulative cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zappi-dw-cap-'))
    const path = join(dir, 'pending-ops.json')
    const intent = (n: number): MoneyOutIntent => ({
      kind: 'send',
      potId: 'pot_a',
      sourceAddress: ADDRESS_A,
      receiver: ADDRESS_A,
      amountCents: 60,
      asset: 'USDB',
      network: 'MAINNET',
    })
    const deps = {
      path,
      env: { ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H: '100' },
      now: () => new Date('2026-01-01T00:00:00Z'),
    }
    try {
      const results = await Promise.allSettled([
        beginOperation(intent(1), 'k1', deps),
        beginOperation(intent(2), 'k2', deps),
      ])
      const ok = results.filter((r) => r.status === 'fulfilled')
      const bad = results.filter((r) => r.status === 'rejected')
      assert.equal(ok.length, 1)
      assert.equal(bad.length, 1)
      assert.match(String((bad[0] as PromiseRejectedResult).reason), /Cumulative money-out/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an auth-required context never reaches the free Spark signer', async () => {
    const ctx = Object.freeze({
      potId: 'pot_a',
      sparkAddress: REGTEST_ADDR,
      spendMode: 'auth_required',
      network: 'MAINNET',
      derivationMode: 'spark',
      accountIndex: 1,
      source: 'registry',
      getSeed: () => {
        throw new Error('seed must not be read')
      },
    }) as unknown as PotContext
    await assert.rejects(
      () =>
        runSendSparkUsdb(REGTEST_ADDR, 10, 'plain', {}, async () => ctx),
      /free pots only/,
    )
  })
})

describe('1-462 secret leakage', () => {
  it('redacts passphrase, key-file, and registry paths from debug text', () => {
    const redacted = redactSecrets(
      'ZAPPI_POT_PASSPHRASE=super-secret ZAPPI_POT_KEY_FILE=/tmp/pot.txt ZAPPI_POT_REGISTRY_FILE=/tmp/pots.json',
    )
    assert.doesNotMatch(redacted, /super-secret/)
    assert.doesNotMatch(redacted, /\/tmp\/pot\.txt/)
    assert.doesNotMatch(redacted, /\/tmp\/pots\.json/)
    assert.match(redacted, /ZAPPI_POT_PASSPHRASE=\[redacted\]/)
  })

  it('pay and send modules do not spawn a child with the seed', () => {
    for (const file of ['paywall.js', 'send-commands.js', 'pending-ops.js', 'pot-registry.js']) {
      const source = readFileSync(join(here, file), 'utf8')
      assert.doesNotMatch(source, /child_process/)
      assert.doesNotMatch(source, /spawn\(/)
    }
  })
})
