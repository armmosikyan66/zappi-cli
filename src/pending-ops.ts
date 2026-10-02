/**
 * Durable pending-operation journal for free-pot money-out paths — Linear
 * 1-456 stage 5 / 1-461 (slice 5b). See docs/signer-boundary.md.
 *
 * Around every pay/send submission the gate records a pending op keyed by the
 * intent-bound idempotency key. On timeout/crash/ambiguous settlement the same
 * op is reconciled instead of issuing a second payment. Per-payment and
 * cumulative caps are enforced across all free-pot money-out paths, including
 * concurrent attempts. Defense in depth, not protection from raw-seed
 * compromise. POSIX only. Windows refused. Free pots only. Never stores seed.
 */

import {
  chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, statSync, unlinkSync, writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { PotEnv } from './env.js'
import { intentHash, type MoneyOutIntent } from './pot-outgate.js'

export const JOURNAL_VERSION = 1
export const MAX_JOURNAL_BYTES = 1 << 20
export const MAX_OPS = 1024
const FILE_MODE = 0o600
const DIR_MODE = 0o700
const LOCK_STALE_MS = 30_000
const LOCK_TIMEOUT_MS = 2_000
const LOCK_POLL_MS = 25
const CUMULATIVE_WINDOW_MS = 24 * 60 * 60 * 1000

export type OpStatus = 'pending' | 'submitted' | 'settled' | 'failed'

export interface PendingOp {
  idempotencyKey: string
  intentHash: string
  kind: 'pay' | 'send'
  potId: string
  receiver: string
  amountCents: number
  asset: string
  network: 'MAINNET' | 'REGTEST'
  resourceId?: string
  status: OpStatus
  sparkTxHash?: string
  createdAt: string
  updatedAt: string
  failReason?: string
}

export interface JournalFile {
  version: typeof JOURNAL_VERSION
  ops: Record<string, PendingOp>
}

export interface JournalDeps {
  env?: PotEnv
  now?: () => Date
  path?: string
}

export type BeginAction =
  | { action: 'sign'; op: PendingOp }
  | { action: 'reconcile'; op: PendingOp }
  | { action: 'done'; op: PendingOp }
  | { action: 'unknown'; op: PendingOp }

export interface CapsConfig {
  maxPerPayment?: number
  maxCumulative24h?: number
}

export function resolveCapsConfig(env: PotEnv = process.env): CapsConfig {
  const cfg: CapsConfig = {}
  const per = env.ZAPPI_POT_MAX_PER_PAYMENT_CENTS?.trim()
  if (per) {
    const n = Number(per)
    if (!Number.isInteger(n) || n <= 0) throw new Error('ZAPPI_POT_MAX_PER_PAYMENT_CENTS must be a positive integer.')
    cfg.maxPerPayment = n
  }
  const cum = env.ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H?.trim()
  if (cum) {
    const n = Number(cum)
    if (!Number.isInteger(n) || n <= 0) throw new Error('ZAPPI_POT_MAX_CUMULATIVE_CENTS_24H must be a positive integer.')
    cfg.maxCumulative24h = n
  }
  return cfg
}

export function capsEnabled(cfg: CapsConfig): boolean {
  return cfg.maxPerPayment != null || cfg.maxCumulative24h != null
}

function refuseWindows(): void {
  if (process.platform === 'win32') {
    throw new Error('The free-pot pending-operation journal is not supported on Windows yet.')
  }
}

export function journalPath(env: PotEnv = process.env): string {
  const override = env.ZAPPI_POT_PENDING_OPS_FILE?.trim()
  if (override) return override
  return join(homedir(), '.zappi', 'pending-ops.json')
}

function assertSafePath(path: string): void {
  refuseWindows()
  try {
    const d = lstatSync(dirname(path))
    if (d.isSymbolicLink()) throw new Error(`Refusing to use a symlink for the journal dir: ${dirname(path)}`)
    if ((d.mode & 0o077) !== 0) throw new Error(`Refusing to use journal dir ${dirname(path)}: other users can read/write it.`)
    if (typeof process.getuid === 'function' && d.uid !== process.getuid()) throw new Error(`Refusing to use journal dir ${dirname(path)}: not owned by you.`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  try {
    const f = lstatSync(path)
    if (f.isSymbolicLink()) throw new Error(`Refusing to use a symlink for the journal: ${path}`)
    if ((f.mode & 0o077) !== 0) throw new Error(`Refusing to use journal ${path}: other users can read/write it. Run chmod 600 ${path}.`)
    if (typeof process.getuid === 'function' && f.uid !== process.getuid()) throw new Error(`Refusing to use journal ${path}: not owned by you.`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertString(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new Error(`Journal field ${name} is missing or too long.`)
  return v
}

function assertOptionalString(v: unknown, name: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || v.length > max) throw new Error(`Journal field ${name} is too long.`)
  return v
}

function assertInt(v: unknown, name: string, min: number): number {
  if (!Number.isInteger(v) || (v as number) < min) throw new Error(`Journal field ${name} must be an integer >= ${min}.`)
  return v as number
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function validateJournalFile(raw: unknown): JournalFile {
  if (!isPlainObject(raw)) throw new Error('Journal file is not an object.')
  if (raw.version !== JOURNAL_VERSION) throw new Error(`Journal version ${String(raw.version)} is unsupported.`)
  const opsRaw = (raw as Record<string, unknown>).ops
  if (!isPlainObject(opsRaw)) throw new Error('Journal ops is not an object.')
  const ops: Record<string, PendingOp> = Object.create(null)
  let count = 0
  for (const [key, value] of Object.entries(opsRaw)) {
    if (PROTOTYPE_KEYS.has(key)) throw new Error(`Journal op key ${key} is reserved.`)
    if (!isPlainObject(value)) throw new Error(`Journal op ${key} is not an object.`)
    const r = value as Record<string, unknown>
    const kind = r.kind === 'pay' || r.kind === 'send' ? r.kind : null
    const network = r.network === 'MAINNET' || r.network === 'REGTEST' ? r.network : null
    const status = (['pending', 'submitted', 'settled', 'failed'] as const).includes(r.status as OpStatus) ? (r.status as OpStatus) : null
    if (!kind || !network || !status) throw new Error(`Journal op ${key} has bad kind/network/status.`)
    const op: PendingOp = {
      idempotencyKey: assertString(r.idempotencyKey, 'idempotencyKey', 128),
      intentHash: assertString(r.intentHash, 'intentHash', 128),
      kind,
      potId: assertString(r.potId, 'potId', 128),
      receiver: assertString(r.receiver, 'receiver', 256),
      amountCents: assertInt(r.amountCents, 'amountCents', 0),
      asset: assertString(r.asset, 'asset', 32),
      network,
      resourceId: assertOptionalString(r.resourceId, 'resourceId', 128),
      status,
      sparkTxHash: assertOptionalString(r.sparkTxHash, 'sparkTxHash', 256),
      createdAt: assertString(r.createdAt, 'createdAt', 64),
      updatedAt: assertString(r.updatedAt, 'updatedAt', 64),
      failReason: assertOptionalString(r.failReason, 'failReason', 1024),
    }
    if (op.idempotencyKey !== key) throw new Error(`Journal op key ${key} must equal idempotencyKey.`)
    ops[key] = op
    count += 1
    if (count > MAX_OPS) throw new Error('Journal has too many ops.')
  }
  return { version: JOURNAL_VERSION, ops }
}

function readJournal(path: string): JournalFile | null {
  let raw: string
  try {
    const stat = statSync(path)
    if (stat.size > MAX_JOURNAL_BYTES) throw new Error(`Journal file ${path} is too large (${stat.size} bytes).`)
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return null
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Journal file ${path} is not valid JSON.`)
  }
  return validateJournalFile(parsed)
}

function writeJournal(path: string, file: JournalFile): void {
  refuseWindows()
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE })
  try { chmodSync(dirname(path), DIR_MODE) } catch { /* tighter existing */ }
  const body = `${JSON.stringify(file, null, 2)}\n`
  if (Buffer.byteLength(body) > MAX_JOURNAL_BYTES) throw new Error('Journal would exceed the size limit; refusing to write.')
  const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(tmp, 'wx', FILE_MODE)
    const buf = Buffer.from(body, 'utf8')
    let off = 0
    while (off < buf.length) off += writeSync(fd, buf, off)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmp, path)
    let dfd: number | undefined
    try { dfd = openSync(dirname(path), 'r'); fsyncSync(dfd); closeSync(dfd) } catch { /* ignore */ }
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch { /* ignore */ }
    try { unlinkSync(tmp) } catch { /* gone */ }
  }
}

const locks: Map<string, Promise<unknown>> = new Map()

function withMutex<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(path) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const stored = next.then(() => undefined, () => undefined)
  locks.set(path, stored)
  stored.then(() => { if (locks.get(path) === stored) locks.delete(path) })
  return next
}

async function withFileLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let fd: number | undefined
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx', FILE_MODE)
      writeSync(fd, `${process.pid}\n${Date.now()}\n`)
      fsyncSync(fd)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      try {
        const st = statSync(lockPath)
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { unlinkSync(lockPath); continue }
      } catch { /* retry */ }
      if (Date.now() >= deadline) throw new Error(`Could not acquire journal lock ${lockPath} (held by another process).`)
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS))
    }
  }
  try {
    return await fn()
  } finally {
    try { closeSync(fd) } catch { /* ignore */ }
    try { unlinkSync(lockPath) } catch { /* ignore */ }
  }
}

async function withLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  return withMutex(path, () => withFileLock(path, fn))
}

function committedAmounts(file: JournalFile, now: Date): number {
  const cutoff = now.getTime() - CUMULATIVE_WINDOW_MS
  let total = 0
  for (const op of Object.values(file.ops)) {
    // Pending counts too: a concurrent attempt that has not yet recorded a tx
    // hash still reserves the amount, so two parallel signs cannot both pass.
    if (op.status === 'failed') continue
    if (new Date(op.createdAt).getTime() < cutoff) continue
    total += op.amountCents
  }
  return total
}

function enforceCaps(file: JournalFile, intent: MoneyOutIntent, cfg: CapsConfig, now: Date): void {
  if (cfg.maxPerPayment != null && intent.amountCents > cfg.maxPerPayment) {
    throw new Error(`Payment of ${intent.amountCents}¢ exceeds the per-payment cap of ${cfg.maxPerPayment}¢. Refusing to sign.`)
  }
  if (cfg.maxCumulative24h != null) {
    const total = committedAmounts(file, now) + intent.amountCents
    if (total > cfg.maxCumulative24h) {
      throw new Error(`Cumulative money-out (${total}¢ over 24h) would exceed the cap of ${cfg.maxCumulative24h}¢. Refusing to sign.`)
    }
  }
}

function toOp(intent: MoneyOutIntent, idempotencyKey: string, now: Date, status: OpStatus): PendingOp {
  const ts = now.toISOString()
  return {
    idempotencyKey,
    intentHash: intentHash(intent),
    kind: intent.kind,
    potId: intent.potId,
    receiver: intent.receiver.trim(),
    amountCents: intent.amountCents,
    asset: intent.asset,
    network: intent.network,
    ...(intent.resourceId ? { resourceId: intent.resourceId } : {}),
    status,
    createdAt: ts,
    updatedAt: ts,
  }
}

/**
 * Begin a money-out operation. Under the lock: if no op exists for the key,
 * enforce caps and create a `pending` op → `sign`. If an op exists:
 * `submitted` → `reconcile` (retry with the existing tx hash, no re-sign);
 * `settled` → `done`; `pending` → `unknown` (fail closed); `failed` → retry
 * (replace with a fresh `pending` op → `sign`).
 */
export async function beginOperation(
  intent: MoneyOutIntent,
  idempotencyKey: string,
  deps: JournalDeps = {},
): Promise<BeginAction> {
  const env = deps.env ?? process.env
  refuseWindows()
  const path = deps.path ?? journalPath(env)
  const now = (deps.now ?? (() => new Date()))()
  const cfg = resolveCapsConfig(env)
  return withLock(path, () => {
    assertSafePath(path)
    const file = readJournal(path) ?? { version: JOURNAL_VERSION, ops: Object.create(null) }
    const existing = file.ops[idempotencyKey]
    if (!existing) {
      enforceCaps(file, intent, cfg, now)
      const op = toOp(intent, idempotencyKey, now, 'pending')
      file.ops[idempotencyKey] = op
      writeJournal(path, file)
      return { action: 'sign' as const, op }
    }
    if (existing.status === 'settled') return { action: 'done' as const, op: existing }
    if (existing.status === 'submitted') return { action: 'reconcile' as const, op: existing }
    if (existing.status === 'pending') return { action: 'unknown' as const, op: existing }
    // failed → allow a fresh attempt.
    enforceCaps(file, intent, cfg, now)
    const op = toOp(intent, idempotencyKey, now, 'pending')
    file.ops[idempotencyKey] = op
    writeJournal(path, file)
    return { action: 'sign' as const, op }
  })
}

/** Record the signed tx hash and move the op to `submitted`. */
export async function recordSubmitted(
  idempotencyKey: string,
  sparkTxHash: string,
  deps: JournalDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env
  refuseWindows()
  const path = deps.path ?? journalPath(env)
  const now = (deps.now ?? (() => new Date()))()
  return withLock(path, () => {
    assertSafePath(path)
    const file = readJournal(path)
    if (!file || !file.ops[idempotencyKey]) return
    const op = file.ops[idempotencyKey]
    op.status = 'submitted'
    op.sparkTxHash = sparkTxHash
    op.updatedAt = now.toISOString()
    writeJournal(path, file)
  })
}

/** Mark the op `settled` (settlement confirmed). */
export async function markSettled(
  idempotencyKey: string,
  deps: JournalDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env
  refuseWindows()
  const path = deps.path ?? journalPath(env)
  const now = (deps.now ?? (() => new Date()))()
  return withLock(path, () => {
    assertSafePath(path)
    const file = readJournal(path)
    if (!file || !file.ops[idempotencyKey]) return
    const op = file.ops[idempotencyKey]
    op.status = 'settled'
    op.updatedAt = now.toISOString()
    writeJournal(path, file)
  })
}

/** Mark the op `failed` (do not re-sign on next attempt unless explicitly retried). */
export async function markFailed(
  idempotencyKey: string,
  reason: string,
  deps: JournalDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env
  refuseWindows()
  const path = deps.path ?? journalPath(env)
  const now = (deps.now ?? (() => new Date()))()
  return withLock(path, () => {
    assertSafePath(path)
    const file = readJournal(path)
    if (!file || !file.ops[idempotencyKey]) return
    const op = file.ops[idempotencyKey]
    op.status = 'failed'
    op.failReason = reason.slice(0, 1024)
    op.updatedAt = now.toISOString()
    writeJournal(path, file)
  })
}
