/**
 * Encrypted free-pot seed registry — Linear 1-454 (design) + 1-456 (hardening).
 *
 * Stores every free-pot seed as ciphertext in a single 0600 registry keyed by
 * pot id. The CLI decrypts one seed into memory per pot id, signs, and drops it.
 * See `docs/signer-boundary.md` for the boundary contract.
 *
 * Envelope (version 1): PBKDF2-HMAC-SHA256 600k → 32-byte key, salt ≥16 bytes;
 * AES-256-GCM with a fresh 12-byte nonce and explicit 16-byte auth tag. Canonical
 * AAD binds potId/label/sparkAddress/spendMode/network/derivation/accountIndex/
 * apiUrl/appOrigin/createdAt so substituted metadata fails to authenticate.
 *
 * Free pots only. The main-wallet seed is never stored here. Auth_required /
 * client-token / approval logic is untouched. POSIX only for now — Windows is
 * refused with a clear message (ACL checks not implemented; chmod insufficient).
 */

import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto'
import {
  potRegistryPath,
  resolveAppOrigin,
  resolvePaywallBase,
  type PotEnv,
} from './env.js'

export const ENVELOPE_VERSION = 1
export const PBKDF2_ITERATIONS = 600_000
export const PBKDF2_KEY_LEN = 32
export const SALT_LEN = 16
export const GCM_IV_LEN = 12
export const GCM_TAG_LEN = 16

const FILE_MODE = 0o600
const DIR_MODE = 0o700
const MAX_FILE_BYTES = 1 << 20
const MAX_POTS = 256
const MAX_POT_ID_LEN = 128
const MAX_LABEL_LEN = 256
const MAX_ADDRESS_LEN = 256
const MAX_URL_LEN = 1024
const MAX_BASE64_LEN = 4_096
const LOCK_STALE_MS = 30_000
const LOCK_TIMEOUT_MS = 2_000
const LOCK_POLL_MS = 25

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export type SparkNetwork = 'MAINNET' | 'REGTEST'
export type PotDerivationMode = 'spark'
export const DEFAULT_POT_DERIVATION_MODE: PotDerivationMode = 'spark'

export interface PotMetadata {
  potId: string
  label?: string
  sparkAddress: string
  spendMode: 'free'
  network: SparkNetwork
  derivationMode: PotDerivationMode
  accountIndex: number
  apiUrl: string
  appOrigin: string
  createdAt: string
}

export interface PotRecord extends PotMetadata {
  saltB64: string
  ivB64: string
  tagB64: string
  ciphertextB64: string
}

export interface RegistryFile {
  version: typeof ENVELOPE_VERSION
  activePotId?: string
  pots: Record<string, PotRecord>
  /**
   * Seeds sealed before Nest has assigned a pot id. Not selectable for signing
   * until `bindProvisionedSeed` moves one into `pots` under the real id.
   */
  provisions?: Record<string, PotRecord>
}

export interface SealPotSeedInput
  extends Omit<PotMetadata, 'apiUrl' | 'appOrigin' | 'createdAt'> {
  seed: string
}

/* ------------------------------- Canonical AAD ------------------------------ */

export function canonicalAad(record: PotMetadata): Buffer {
  const sorted = {
    v: ENVELOPE_VERSION,
    accountIndex: record.accountIndex,
    appOrigin: record.appOrigin,
    apiUrl: record.apiUrl,
    createdAt: record.createdAt,
    derivationMode: record.derivationMode,
    label: record.label ?? '',
    network: record.network,
    potId: record.potId,
    sparkAddress: record.sparkAddress,
    spendMode: record.spendMode,
  }
  return Buffer.from(JSON.stringify(sorted), 'utf8')
}

/* --------------------------------- Crypto ---------------------------------- */

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, 'sha256')
}

export interface SealedEnvelope {
  saltB64: string
  ivB64: string
  tagB64: string
  ciphertextB64: string
}

export function sealSeed(
  seed: string,
  passphrase: string,
  meta: PotMetadata,
): SealedEnvelope {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(GCM_IV_LEN)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: GCM_TAG_LEN,
  })
  cipher.setAAD(canonicalAad(meta))
  const ciphertext = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    saltB64: salt.toString('base64'),
    ivB64: iv.toString('base64'),
    tagB64: tag.toString('base64'),
    ciphertextB64: ciphertext.toString('base64'),
  }
}

export function openSeed(
  envelope: SealedEnvelope,
  passphrase: string,
  meta: PotMetadata,
): string {
  const salt = decodeBase64(envelope.saltB64, SALT_LEN, 'salt')
  const iv = decodeBase64(envelope.ivB64, GCM_IV_LEN, 'iv')
  const tag = decodeBase64(envelope.tagB64, GCM_TAG_LEN, 'tag')
  const ciphertext = decodeBase64(envelope.ciphertextB64, null, 'ciphertext')
  const key = deriveKey(passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: GCM_TAG_LEN,
  })
  decipher.setAAD(canonicalAad(meta))
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    throw new Error(
      'Free-pot seed could not be authenticated. Wrong ZAPPI_POT_PASSPHRASE, or the registry was tampered with.',
    )
  }
}

/* --------------------------- Bounded schema validation ---------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeBase64(b64: string, expectedLen: number | null, name: string): Buffer {
  if (typeof b64 !== 'string' || b64.length === 0 || b64.length > MAX_BASE64_LEN) {
    throw new Error(`Registry ${name} is missing or oversized.`)
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new Error(`Registry ${name} is not valid base64.`)
  }
  const buf = Buffer.from(b64, 'base64')
  // Strict round-trip: rejects stray characters / wrong padding.
  if (buf.toString('base64') !== b64) {
    throw new Error(`Registry ${name} is not valid base64.`)
  }
  if (expectedLen !== null && buf.length !== expectedLen) {
    throw new Error(`Registry ${name} length mismatch.`)
  }
  return buf
}

function assertString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`Registry field ${name} is missing or too long.`)
  }
  return value
}

function assertOptionalString(
  value: unknown,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`Registry field ${name} is too long.`)
  }
  return value
}

function assertInt(value: unknown, name: string, min: number): number {
  if (!Number.isInteger(value) || (value as number) < min) {
    throw new Error(`Registry field ${name} must be an integer >= ${min}.`)
  }
  return value as number
}

export function validatePotRecord(raw: unknown, expectedPotId: string): PotRecord {
  if (!isPlainObject(raw)) throw new Error('Registry pot entry is not an object.')
  const r = raw as Record<string, unknown>
  const potId = assertString(r.potId, 'potId', MAX_POT_ID_LEN)
  if (potId !== expectedPotId) {
    throw new Error('Registry dictionary key must equal the record potId.')
  }
  const label = assertOptionalString(r.label, 'label', MAX_LABEL_LEN)
  const sparkAddress = assertString(r.sparkAddress, 'sparkAddress', MAX_ADDRESS_LEN)
  if (r.spendMode !== 'free') {
    throw new Error('Registry only stores free pots. Auth_required pots are not signed here.')
  }
  if (r.network !== 'MAINNET' && r.network !== 'REGTEST') {
    throw new Error('Registry network must be MAINNET or REGTEST.')
  }
  if (r.derivationMode !== 'spark') {
    throw new Error('Registry derivationMode must be "spark" (v1).')
  }
  const accountIndex = assertInt(r.accountIndex, 'accountIndex', 0)
  const apiUrl = assertString(r.apiUrl, 'apiUrl', MAX_URL_LEN)
  const appOrigin = assertString(r.appOrigin, 'appOrigin', MAX_URL_LEN)
  const createdAt = assertString(r.createdAt, 'createdAt', 64)
  const saltB64 = assertString(r.saltB64, 'saltB64', MAX_BASE64_LEN)
  const ivB64 = assertString(r.ivB64, 'ivB64', MAX_BASE64_LEN)
  const tagB64 = assertString(r.tagB64, 'tagB64', MAX_BASE64_LEN)
  const ciphertextB64 = assertString(r.ciphertextB64, 'ciphertextB64', MAX_BASE64_LEN)
  decodeBase64(saltB64, SALT_LEN, 'salt')
  decodeBase64(ivB64, GCM_IV_LEN, 'iv')
  decodeBase64(tagB64, GCM_TAG_LEN, 'tag')
  decodeBase64(ciphertextB64, null, 'ciphertext')
  return Object.assign(Object.create(null), {
    potId,
    ...(label ? { label } : {}),
    sparkAddress,
    spendMode: 'free' as const,
    network: r.network as SparkNetwork,
    derivationMode: 'spark' as const,
    accountIndex,
    apiUrl,
    appOrigin,
    createdAt,
    saltB64,
    ivB64,
    tagB64,
    ciphertextB64,
  })
}

export function validateRegistryFile(raw: unknown): RegistryFile {
  if (!isPlainObject(raw)) throw new Error('Registry file is not a JSON object.')
  const version = (raw as Record<string, unknown>).version
  if (version !== ENVELOPE_VERSION) {
    throw new Error(
      `Registry version ${String(version)} is unsupported (expected ${ENVELOPE_VERSION}).`,
    )
  }
  const activePotId = assertOptionalString(
    (raw as Record<string, unknown>).activePotId,
    'activePotId',
    MAX_POT_ID_LEN,
  )
  const potsRaw = (raw as Record<string, unknown>).pots
  if (!isPlainObject(potsRaw)) throw new Error('Registry pots field is not an object.')
  const keys = Object.keys(potsRaw)
  if (keys.length > MAX_POTS) {
    throw new Error(`Registry holds too many pots (${keys.length} > ${MAX_POTS}).`)
  }
  const pots: Record<string, PotRecord> = Object.create(null)
  for (const key of keys) {
    if (PROTOTYPE_KEYS.has(key)) {
      throw new Error(`Registry pot key "${key}" is not allowed (prototype pollution).`)
    }
    if (key.length === 0 || key.length > MAX_POT_ID_LEN) {
      throw new Error('Registry pot key is missing or too long.')
    }
    pots[key] = validatePotRecord((potsRaw as Record<string, unknown>)[key], key)
  }
  const provisionsRaw = (raw as Record<string, unknown>).provisions
  const provisions: Record<string, PotRecord> = Object.create(null)
  if (provisionsRaw !== undefined) {
    if (!isPlainObject(provisionsRaw)) {
      throw new Error('Registry provisions field is not an object.')
    }
    for (const key of Object.keys(provisionsRaw)) {
      if (PROTOTYPE_KEYS.has(key)) {
        throw new Error(`Registry provision key "${key}" is not allowed (prototype pollution).`)
      }
      if (key.length === 0 || key.length > MAX_POT_ID_LEN) {
        throw new Error('Registry provision key is missing or too long.')
      }
      provisions[key] = validatePotRecord(
        (provisionsRaw as Record<string, unknown>)[key],
        key,
      )
    }
  }
  if (keys.length + Object.keys(provisions).length > MAX_POTS) {
    throw new Error(`Registry holds too many pots (${keys.length} > ${MAX_POTS}).`)
  }
  if (activePotId !== undefined && !(activePotId in pots)) {
    throw new Error('Registry activePotId does not refer to a stored pot.')
  }
  return {
    version: ENVELOPE_VERSION,
    ...(activePotId ? { activePotId } : {}),
    pots,
    ...(Object.keys(provisions).length > 0 ? { provisions } : {}),
  }
}

/* --------------------------------- Storage --------------------------------- */

function refuseWindows(): void {
  if (process.platform === 'win32') {
    throw new Error(
      'The encrypted free-pot registry is not supported on Windows yet. ' +
        'ACL-based permission checks are required (chmod alone is insufficient). ' +
        'Run the signer on macOS/Linux, or see docs/signer-boundary.md §6.',
    )
  }
}

/**
 * Create the registry/journal directory before any lock file is opened.
 * A missing parent used to make `openSync(path.lock)` throw ENOENT on a fresh
 * host. Existing symlinks, non-directories, group/other permissions, and
 * foreign owners fail closed. Newly created directories are chmod 0700 after
 * mkdir (umask can widen the requested mode). Ancestors that already exist
 * are refused when they are symlinks, but are not required to be mode 0700
 * (the home directory is not).
 */
export function ensureSecureDirectory(dir: string, label = 'registry'): void {
  refuseWindows()
  const parent = dirname(dir)
  if (parent !== dir) {
    let parentStat: ReturnType<typeof lstatSync>
    try {
      parentStat = lstatSync(parent)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      ensureSecureDirectory(parent, label)
      parentStat = lstatSync(parent)
    }
    if (parentStat.isSymbolicLink()) {
      throw new Error(`Refusing to use a symlink for the ${label} parent: ${parent}`)
    }
    if (!parentStat.isDirectory()) {
      throw new Error(`${label} parent ${parent} is not a directory.`)
    }
  }

  let created = false
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      mkdirSync(dir, { mode: DIR_MODE })
      created = true
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
    }
    if (created) {
      try {
        chmodSync(dir, DIR_MODE)
      } catch {
        // re-checked below
      }
    }
    stat = lstatSync(dir)
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to use a symlink for the ${label}: ${dir}`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} path ${dir} is not a directory.`)
  }
  if (created) {
    try {
      chmodSync(dir, DIR_MODE)
    } catch {
      // re-checked below
    }
    stat = lstatSync(dir)
  }
  assertRestrictiveMode(dir, stat.mode & 0o777, 'directory')
  assertOwnedByUs(dir, stat, 'directory')
}

function assertNoSymlink(path: string, stat: { isSymbolicLink?: () => boolean }): void {
  if (stat.isSymbolicLink?.()) {
    throw new Error(`Refusing to use a symlink for the registry: ${path}`)
  }
}

function assertRestrictiveMode(path: string, mode: number, label: string): void {
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to use ${label} ${path}: other users can read/write it. Run chmod ${label === 'file' ? '600' : '700'} ${path}.`,
    )
  }
}

function assertOwnedByUs(path: string, stat: { uid: number }, label: string): void {
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(
      `Refusing to use ${label} ${path}: it is owned by uid ${stat.uid}, not by you (uid ${process.getuid()}).`,
    )
  }
}

/** Validate the registry file and its parent dir for ownership/perms/symlinks. */
function assertSafeRegistryPath(path: string): void {
  refuseWindows()
  let dirStat
  try {
    dirStat = lstatSync(dirname(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Registry directory ${dirname(path)} does not exist. It must be created securely before use.`,
      )
    }
    throw error
  }
  assertNoSymlink(dirname(path), dirStat)
  assertRestrictiveMode(dirname(path), dirStat.mode & 0o777, 'directory')
  assertOwnedByUs(dirname(path), dirStat, 'directory')
  try {
    const fileStat = lstatSync(path)
    assertNoSymlink(path, fileStat)
    assertRestrictiveMode(path, fileStat.mode & 0o777, 'file')
    assertOwnedByUs(path, fileStat, 'file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function readRegistryFile(path: string): RegistryFile | null {
  let raw: string
  try {
    const stat = statSync(path)
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`Registry file ${path} is too large (${stat.size} bytes).`)
    }
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Registry file ${path} is not valid JSON.`)
  }
  return validateRegistryFile(parsed)
}

/** Crash-safe atomic write: temp file (random name) → fsync → rename → dir fsync. */
function writeRegistryFile(path: string, file: RegistryFile): void {
  refuseWindows()
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE })
  try {
    chmodSyncSafe(dirname(path), DIR_MODE)
  } catch {
    // dir may already exist with a tighter mode
  }
  const body = `${JSON.stringify(file, null, 2)}\n`
  if (Buffer.byteLength(body) > MAX_FILE_BYTES) {
    throw new Error('Registry would exceed the size limit; refusing to write.')
  }
  const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(tmp, 'wx', FILE_MODE)
    writeFileSyncViaFd(fd, body)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmp, path)
    fsyncDir(dirname(path))
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
    try {
      unlinkSync(tmp)
    } catch {
      // tmp already renamed or gone
    }
  }
}

function writeFileSyncViaFd(fd: number, body: string): void {
  const buf = Buffer.from(body, 'utf8')
  let offset = 0
  while (offset < buf.length) {
    offset += writeSync(fd, buf, offset)
  }
}

function chmodSyncSafe(path: string, mode: number): void {
  chmodSync(path, mode)
}

function fsyncDir(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    // best-effort; some filesystems cannot fsync a directory
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
  }
}

/* --------------------------- Cross-process locking -------------------------- */

const locks: Map<string, Promise<unknown>> = new Map()

function withProcessLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(path) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  // Store an always-resolved promise so a rejection from `fn` never surfaces
  // as an unhandledRejection on the lock chain. The caller still sees `next`.
  const stored = next.then(
    () => undefined,
    () => undefined,
  )
  locks.set(path, stored)
  stored.then(() => {
    if (locks.get(path) === stored) locks.delete(path)
  })
  return next
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface FileLock {
  release: () => void
}

async function acquireFileLock(path: string): Promise<FileLock> {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    let fd: number | undefined
    try {
      fd = openSync(lockPath, 'wx', FILE_MODE)
      writeSync(fd, `${process.pid}\n${Date.now()}\n`)
      fsyncSync(fd)
      return {
        release: () => {
          try {
            closeSync(fd as number)
          } catch {
            // ignore
          }
          try {
            unlinkSync(lockPath)
          } catch {
            // ignore
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const stat = statSync(lockPath)
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath)
          continue
        }
      } catch {
        // lock gone; retry
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Could not acquire registry lock ${lockPath} (held by another process).`,
        )
      }
      await sleep(LOCK_POLL_MS)
    }
  }
}

async function withFileLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  const lock = await acquireFileLock(path)
  try {
    return await fn()
  } finally {
    lock.release()
  }
}

/** In-process mutex + cross-process file lock around a read-modify-write. */
function withRegistryLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  return withProcessLock(path, async () => {
    // Parent must exist before the lock file is created. Competing fresh-host
    // initializers share this path: mkdir is idempotent, then the file lock
    // serializes the first write.
    ensureSecureDirectory(dirname(path), 'registry')
    return withFileLock(path, fn)
  })
}

/** Read the registry under the same lock and path checks as writers. */
export async function readRegistryAt(path: string): Promise<RegistryFile | null> {
  return withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    return readRegistryFile(path)
  })
}

/**
 * Atomically replace the registry. Refuses a symlink destination (rename
 * replaces the directory entry; it does not follow a final symlink, and a
 * symlink is rejected before the write).
 */
export async function commitRegistryAt(path: string, file: RegistryFile): Promise<void> {
  const checked = validateRegistryFile(file)
  await withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    writeRegistryFile(path, checked)
  })
}

/**
 * Read-modify-write under one lock. `mutate` must not write; the commit
 * happens only if it returns. A throw leaves the live file untouched.
 */
export async function updateRegistryAt(
  path: string,
  mutate: (file: RegistryFile) => RegistryFile,
): Promise<void> {
  await withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    if (!file) throw new Error('Free-pot seed registry is empty.')
    const next = validateRegistryFile(mutate(file))
    writeRegistryFile(path, next)
  })
}

/* ------------------------------- Public API -------------------------------- */

export interface PotRegistryDeps {
  env?: PotEnv
  /** Override now for deterministic createdAt in tests. */
  now?: () => Date
}

function resolveEnv(env?: PotEnv): PotEnv {
  return env ?? process.env
}

function trustedEndpoints(env: PotEnv): { apiUrl: string; appOrigin: string } {
  // Endpoints are always taken from trusted env config, never caller-supplied,
  // so an attacker who can write the registry cannot redirect the signer.
  return { apiUrl: resolvePaywallBase(env), appOrigin: resolveAppOrigin(env) }
}

function assertEndpointsTrusted(record: PotRecord, env: PotEnv): void {
  const trusted = trustedEndpoints(env)
  if (record.apiUrl !== trusted.apiUrl || record.appOrigin !== trusted.appOrigin) {
    throw new Error(
      'Registry pot endpoints do not match the trusted configuration. ' +
        'Refusing to sign against an untrusted API/app origin (fail closed).',
    )
  }
}

/**
 * Decrypt every envelope and check trusted endpoints before a restore or
 * rotation commit. A throw means the caller must not replace the live file.
 * The opened seeds are dropped; this does not export them.
 */
export function authenticateRegistryFile(
  file: RegistryFile,
  passphrase: string,
  env: PotEnv,
): void {
  const records = [
    ...Object.values(file.pots),
    ...Object.values(file.provisions ?? {}),
  ]
  for (const record of records) {
    assertEndpointsTrusted(record, env)
    openSeed(record, passphrase, record)
  }
}

/** Seal a free-pot seed into the registry under its pot id. */
export async function savePotSeed(
  input: SealPotSeedInput,
  passphrase: string,
  deps: PotRegistryDeps = {},
): Promise<PotRecord> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  if (input.spendMode !== 'free') {
    throw new Error('Only free pots may be sealed in this registry.')
  }
  const { apiUrl, appOrigin } = trustedEndpoints(env)
  const createdAt = (deps.now ?? (() => new Date()))().toISOString()
  const meta: PotMetadata = {
    potId: input.potId,
    ...(input.label ? { label: input.label } : {}),
    sparkAddress: input.sparkAddress,
    spendMode: 'free',
    network: input.network,
    derivationMode: input.derivationMode,
    accountIndex: input.accountIndex,
    apiUrl,
    appOrigin,
    createdAt,
  }
  const envelope = sealSeed(input.seed, passphrase, meta)
  const record: PotRecord = { ...meta, ...envelope }
  const path = potRegistryPath(env)
  await withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file: RegistryFile =
      readRegistryFile(path) ?? { version: ENVELOPE_VERSION, pots: Object.create(null) }
    file.pots[record.potId] = record
    if (!file.activePotId) file.activePotId = record.potId
    writeRegistryFile(path, file)
  })
  return record
}

export interface ProvisionSeedInput {
  label?: string
  sparkAddress: string
  network: SparkNetwork
  derivationMode: PotDerivationMode
  accountIndex: number
  seed: string
}

/**
 * Seal a newly generated seed before Nest has a pot id. The record lives under
 * `provisions`, not `pots`, so it cannot be selected for signing until
 * {@link bindProvisionedSeed}.
 */
export async function saveProvisionedSeed(
  input: ProvisionSeedInput,
  passphrase: string,
  deps: PotRegistryDeps = {},
): Promise<{ provisionId: string; record: PotRecord }> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  const provisionId = `prov_${randomBytes(8).toString('hex')}`
  const { apiUrl, appOrigin } = trustedEndpoints(env)
  const createdAt = (deps.now ?? (() => new Date()))().toISOString()
  const meta: PotMetadata = {
    potId: provisionId,
    ...(input.label ? { label: input.label } : {}),
    sparkAddress: input.sparkAddress,
    spendMode: 'free',
    network: input.network,
    derivationMode: input.derivationMode,
    accountIndex: input.accountIndex,
    apiUrl,
    appOrigin,
    createdAt,
  }
  const record: PotRecord = { ...meta, ...sealSeed(input.seed, passphrase, meta) }
  const path = potRegistryPath(env)
  await withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file: RegistryFile =
      readRegistryFile(path) ?? { version: ENVELOPE_VERSION, pots: Object.create(null) }
    const provisions = file.provisions ?? Object.create(null)
    provisions[provisionId] = record
    file.provisions = provisions
    writeRegistryFile(path, file)
  })
  return { provisionId, record }
}

/**
 * Move a provisioning record onto the Nest pot id. Refuses when that id
 * already holds a different address, network, or account index. Re-seals
 * because the authenticated pot id is part of the AAD.
 */
export async function bindProvisionedSeed(
  provisionId: string,
  potId: string,
  passphrase: string,
  deps: PotRegistryDeps = {},
): Promise<PotRecord> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  if (!potId.trim() || potId === provisionId) {
    throw new Error('Pass the Nest pot id to bind. It must differ from the local provision id.')
  }
  const path = potRegistryPath(env)
  let bound: PotRecord | undefined
  await withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    const provision = file?.provisions?.[provisionId]
    if (!file || !provision) {
      throw new Error(`Provision ${provisionId} is not in the registry.`)
    }
    assertEndpointsTrusted(provision, env)
    const seed = openSeed(provision, passphrase, provision)
    const existing = file.pots[potId]
    if (
      existing &&
      (existing.sparkAddress !== provision.sparkAddress ||
        existing.network !== provision.network ||
        existing.accountIndex !== provision.accountIndex ||
        existing.derivationMode !== provision.derivationMode)
    ) {
      throw new Error(
        `Refusing to bind ${provisionId} onto ${potId}: that pot already has a different address, network, or account index.`,
      )
    }
    const { apiUrl, appOrigin } = trustedEndpoints(env)
    const meta: PotMetadata = {
      potId,
      ...(provision.label ? { label: provision.label } : {}),
      sparkAddress: provision.sparkAddress,
      spendMode: 'free',
      network: provision.network,
      derivationMode: provision.derivationMode,
      accountIndex: provision.accountIndex,
      apiUrl,
      appOrigin,
      createdAt: existing?.createdAt ?? provision.createdAt,
    }
    const record: PotRecord = { ...meta, ...sealSeed(seed, passphrase, meta) }
    file.pots[potId] = record
    if (!file.activePotId) file.activePotId = potId
    if (file.provisions) delete file.provisions[provisionId]
    if (file.provisions && Object.keys(file.provisions).length === 0) {
      delete file.provisions
    }
    writeRegistryFile(path, file)
    bound = record
  })
  if (!bound) throw new Error(`Provision ${provisionId} is not in the registry.`)
  return bound
}

/** Decrypt + authenticate the seed for one pot id. Fails closed on any mismatch. */
export async function loadPotSeedFromRegistry(
  potId: string,
  passphrase: string,
  deps: PotRegistryDeps = {},
): Promise<{ seed: string; record: PotRecord }> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  const path = potRegistryPath(env)
  return withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    if (!file) throw new Error('Free-pot seed registry is empty. Run `zappi-cli propose --generate` first.')
    const record = file.pots[potId]
    if (!record) throw new Error(`Pot ${potId} is not in the free-pot seed registry.`)
    assertEndpointsTrusted(record, env)
    const seed = openSeed(record, passphrase, record)
    return { seed, record }
  })
}

/** List sealed pots. Never returns the seed or envelope material. */
export async function listPots(
  deps: PotRegistryDeps = {},
): Promise<Array<Pick<PotRecord, 'potId' | 'label' | 'sparkAddress' | 'spendMode' | 'network' | 'accountIndex' | 'createdAt'>>> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  const path = potRegistryPath(env)
  return withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    if (!file) return []
    return Object.values(file.pots).map((r) => ({
      potId: r.potId,
      ...(r.label ? { label: r.label } : {}),
      sparkAddress: r.sparkAddress,
      spendMode: r.spendMode,
      network: r.network,
      accountIndex: r.accountIndex,
      createdAt: r.createdAt,
    }))
  })
}

/** Remove local access to a pot (delete its registry entry). No on-chain effect. */
export async function removePot(
  potId: string,
  deps: PotRegistryDeps = {},
): Promise<boolean> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  const path = potRegistryPath(env)
  return withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    if (!file) return false
    if (!(potId in file.pots)) return false
    delete file.pots[potId]
    if (file.activePotId === potId) {
      const remaining = Object.keys(file.pots)
      file.activePotId = remaining[0]
    }
    writeRegistryFile(path, file)
    return true
  })
}

/** Set the active pot id used when no `--pot`/`ZAPPI_POT_ID` is given. */
export async function setActivePot(
  potId: string,
  deps: PotRegistryDeps = {},
): Promise<void> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  const path = potRegistryPath(env)
  await withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    if (!file) throw new Error('Free-pot seed registry is empty.')
    if (!(potId in file.pots)) throw new Error(`Pot ${potId} is not in the registry.`)
    file.activePotId = potId
    writeRegistryFile(path, file)
  })
}

/** Read the active pot id, if any. Does not decrypt. */
export async function getActivePot(
  deps: PotRegistryDeps = {},
): Promise<string | undefined> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  const path = potRegistryPath(env)
  return withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    return file?.activePotId
  })
}

/** Read one pot record (no seed). Throws if missing or endpoints drift. */
export async function getPotRecord(
  potId: string,
  deps: PotRegistryDeps = {},
): Promise<PotRecord> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  const path = potRegistryPath(env)
  return withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    if (!file) throw new Error(`Pot ${potId} is not in the free-pot seed registry.`)
    const record = file.pots[potId]
    if (!record) throw new Error(`Pot ${potId} is not in the free-pot seed registry.`)
    assertEndpointsTrusted(record, env)
    return record
  })
}

/** Like getPotRecord but returns null when the pot is absent (no throw). Endpoints still checked. */
export async function findPotRecord(
  potId: string,
  deps: PotRegistryDeps = {},
): Promise<PotRecord | null> {
  const env = resolveEnv(deps.env)
  refuseWindows()
  const path = potRegistryPath(env)
  return withRegistryLock(path, () => {
    assertSafeRegistryPath(path)
    const file = readRegistryFile(path)
    if (!file) return null
    const record = file.pots[potId]
    if (!record) return null
    assertEndpointsTrusted(record, env)
    return record
  })
}

