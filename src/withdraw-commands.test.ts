/**
 * Path-level free-pot gate for withdraw confirm, send internal, and send external.
 *
 * Each command signs only through gateAndSignFreePot and passes the durable
 * journal. Quote-expiry reconcile, unknown-broadcast fail-closed, and
 * cumulative-cap serialization already live on that choke point
 * (review-1-482.test.ts, review-1-468.test.ts, pending-ops.test.ts). These
 * tests pin the routed command: a disagreeing --pot / --pot-id fails closed
 * before Nest, a second run reconciles the journaled hash without sendUsdb,
 * and the per-payment cap rejects before sendUsdb.
 *
 * pay already fails closed on the same pot conflict (review-1-482.test.ts)
 * and replays through its journal (paywall.test.ts). Direct Spark send
 * (runSendSparkUsdb) fails closed on that conflict in review-1-482.test.ts
 * and journals via beginOperation inside send-commands.ts. It does not call
 * gateAndSignFreePot, so the choke-point replay tests do not cover it.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { bech32m } from '@scure/base'
import type { PotEnv } from './env.js'
import {
  runSendExternal,
  runSendInternal,
  runWithdrawConfirm,
  type MoneyOutHooks,
} from './withdraw-commands.js'

const POT_ADDRESS = bech32m.encode('spark', bech32m.toWords(new Uint8Array(32).fill(4)))
const DEPOSIT = bech32m.encode('spark', bech32m.toWords(new Uint8Array(32).fill(9)))
const HASH = 'ab'.repeat(32)
const PATHS = ['withdraw confirm', 'send internal', 'send external'] as const

type MoneyPath = (typeof PATHS)[number]

interface Captured {
  url: string
  body: Record<string, unknown> | undefined
}

interface JournalOp {
  status: string
  sparkTxHash?: string
  amountCents: number
  receiver: string
  potId: string
}

function envFor(dir: string, extra: PotEnv = {}): PotEnv {
  return {
    ZAPPI_POT_ID: 'pot_a',
    ZAPPI_POT_SPEND_MODE: 'free',
    ZAPPI_POT_SEED: 'not-a-real-mnemonic',
    ZAPPI_POT_SPARK_ADDRESS: POT_ADDRESS,
    ZAPPI_POT_REGISTRY_FILE: join(dir, 'pots.json'),
    ZAPPI_POT_PENDING_OPS_FILE: join(dir, 'pending-ops.json'),
    ZAPPI_API_URL: 'https://api.test',
    ZAPPI_ACCESS_TOKEN: 'jwt',
    ZAPPI_HOME: dir,
    SPARK_NETWORK: 'MAINNET',
    ...extra,
  }
}

function argvFor(
  path: MoneyPath,
  amount: string,
  flag?: { name: '--pot' | '--pot-id'; id: string },
): string[] {
  const pot = flag ? [flag.name, flag.id] : []
  if (path === 'withdraw confirm') return ['quote_1', ...pot]
  if (path === 'send internal') return ['--to', 'bob', '--amount', amount, ...pot]
  return ['--asset', 'USDB', '--network', 'solana', '--address', '0xabc', '--amount', amount, ...pot]
}

function runPath(
  path: MoneyPath,
  argv: string[],
  env: PotEnv,
  hooks?: MoneyOutHooks,
): Promise<string> {
  if (path === 'withdraw confirm') return runWithdrawConfirm(argv, 'json', env, hooks)
  if (path === 'send internal') return runSendInternal(argv, 'json', env, hooks)
  return runSendExternal(argv, 'json', env, hooks)
}

function mockedSigner(onSign: () => void): MoneyOutHooks {
  return {
    deriveAddress: async () => POT_ADDRESS,
    readTokenIdentifier: async () => 'btkn1usdb',
    sendUsdb: async () => {
      onSign()
      return { sparkTxHash: HASH }
    },
  }
}

function quotePayload(cents: number): Record<string, unknown> {
  return {
    needsSignature: true,
    depositAddress: DEPOSIT,
    tokenIdentifier: 'btkn1usdb',
    sendAmount: String(cents * 10_000),
    expiresAt: '2099-01-01T00:00:00.000Z',
    withdrawalId: 'w1',
    withdrawId: 'wd_1',
    status: 'pending',
  }
}

function settledPayload(sparkTxHash: string): Record<string, unknown> {
  return {
    needsSignature: false,
    withdrawalId: 'w1',
    withdrawId: 'wd_1',
    transferId: 'tr_1',
    status: 'completed',
    sparkTxHash,
  }
}

function nestHandler(path: MoneyPath, cents: number) {
  return (url: string, body: Record<string, unknown> | undefined): Record<string, unknown> => {
    const sparkTxHash = body?.sparkTxHash
    if (typeof sparkTxHash === 'string') return settledPayload(sparkTxHash)
    if (path === 'send internal' && url.includes('/resolve')) {
      return { destinationSparkAddress: DEPOSIT, recipientCustody: 'spark' }
    }
    if (path === 'send internal') return { ok: true, status: 'prepared' }
    return quotePayload(cents)
  }
}

async function withFetch(
  handle: (url: string, body: Record<string, unknown> | undefined) => unknown,
  run: (calls: Captured[]) => Promise<void>,
): Promise<void> {
  const calls: Captured[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    const url = String(input)
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined
    calls.push({ url, body })
    return new Response(JSON.stringify(handle(url, body)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  try {
    await run(calls)
  } finally {
    globalThis.fetch = original
  }
}

function postedHashes(calls: Captured[]): string[] {
  return calls.flatMap((call) =>
    typeof call.body?.sparkTxHash === 'string' ? [call.body.sparkTxHash] : [],
  )
}

function readOps(env: PotEnv): JournalOp[] {
  const path = env.ZAPPI_POT_PENDING_OPS_FILE
  if (!path) throw new Error('missing journal path')
  const file = JSON.parse(readFileSync(path, 'utf8')) as { ops: Record<string, JournalOp> }
  return Object.values(file.ops)
}

describe('free-pot money-out paths', () => {
  for (const path of PATHS) {
    it(`${path} fails closed when --pot or --pot-id disagrees with ZAPPI_POT_ID`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'zappi-pot-conflict-'))
      const env = envFor(dir)
      let fetches = 0
      let signs = 0
      const original = globalThis.fetch
      globalThis.fetch = (async () => {
        fetches += 1
        throw new Error('network after a pot conflict')
      }) as typeof fetch
      const hooks: MoneyOutHooks = {
        ...mockedSigner(() => {
          signs += 1
        }),
        onContext() {
          throw new Error('resolved a pot after a selector conflict')
        },
      }
      try {
        for (const flag of ['--pot', '--pot-id'] as const) {
          await assert.rejects(
            () => runPath(path, argvFor(path, '10', { name: flag, id: 'pot_b' }), env, hooks),
            /Conflicting pot selectors: --pot pot_b but ZAPPI_POT_ID=pot_a/,
          )
        }
        assert.equal(fetches, 0)
        assert.equal(signs, 0)
      } finally {
        globalThis.fetch = original
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it(`${path} reconciles a journaled hash without signing again`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'zappi-money-replay-'))
      const env = envFor(dir)
      let signs = 0
      const hooks = mockedSigner(() => {
        signs += 1
      })
      try {
        await withFetch(nestHandler(path, 25), async (calls) => {
          await runPath(path, argvFor(path, '25'), env, hooks)
          await runPath(path, argvFor(path, '25'), env, hooks)
          assert.equal(signs, 1)
          assert.deepEqual(postedHashes(calls), [HASH, HASH])
        })
        const ops = readOps(env)
        assert.equal(ops.length, 1)
        assert.equal(ops[0]?.status, 'submitted')
        assert.equal(ops[0]?.sparkTxHash, HASH)
        assert.equal(ops[0]?.amountCents, 25)
        assert.equal(ops[0]?.receiver, DEPOSIT)
        assert.equal(ops[0]?.potId, 'pot_a')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it(`${path} enforces the per-payment cap before signing`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'zappi-money-cap-'))
      const env = envFor(dir, { ZAPPI_POT_MAX_PER_PAYMENT_CENTS: '50' })
      let signs = 0
      const hooks = mockedSigner(() => {
        signs += 1
      })
      try {
        await withFetch(nestHandler(path, 100), async (calls) => {
          await assert.rejects(
            () => runPath(path, argvFor(path, '100'), env, hooks),
            /exceeds the per-payment cap/,
          )
          assert.equal(signs, 0)
          assert.equal(postedHashes(calls).length, 0)
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
