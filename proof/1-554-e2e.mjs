#!/usr/bin/env node
/**
 * Linear 1-554 end-to-end proof (mocked data only).
 *
 * Runs the exact string the web "Pair this host" row should copy through the
 * real CLI (`bin/cli.js`, built `dist/`) against a local mock Nest that
 * mirrors the attach rules in zappi-nest `src/wallet/pots/pots-attach.service.ts`
 * (develop ddbeae6). The /pair step reuses the web's own pure helpers from
 * edogbeatz/zappi `lib/pots/pairing-identity.ts` + `lib/pots/copy.ts` (develop
 * b63ee45) and the naming branch of `pot-attach-page.tsx` (lines 182-207, 610-631).
 *
 * Usage: npm run build && WEB_LIB=<dir containing lib/pots> node proof/1-554-e2e.mjs
 * No real credentials. Device codes and pot client tokens are mock values and
 * are never printed; the script asserts they never reach CLI stdout/stderr.
 */
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WEB_LIB = process.env.WEB_LIB
if (!WEB_LIB) throw new Error('Set WEB_LIB to a directory that contains lib/pots/pairing-identity.ts')
const web = await import(join(WEB_LIB, 'lib/pots/pairing-identity.ts'))
const copy = await import(join(WEB_LIB, 'lib/pots/copy.ts'))

const POT_A = 'b3a1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const POT_B = 'c4b2d3e5-6f70-4b8c-9dae-1f2a3b4c5d6e'
const OWNED_POTS = [
  { id: POT_A, label: 'Research bot', spendMode: 'auth_required', status: 'active', origin: 'user' },
  { id: POT_B, label: 'Ops bot', spendMode: 'auth_required', status: 'active', origin: 'user' },
]
/** Exact web copy template (1-554 + 1-555: installed pinned CLI, no npx). */
const WEB_COPY = (potId) => `zappi-cli pots attach --pot ${potId} --spend-mode auth_required`
const OLD_WEB_COPY = 'npx @zappimoney/zappi-cli pots attach --spend-mode auth_required'

const lines = []
const log = (line = '') => {
  lines.push(line)
  process.stdout.write(`${line}\n`)
}
const secrets = new Set()
const boxes = []

/* ------------------------------- mock Nest -------------------------------- */

const POT_ID_SHAPE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,32})$/i
const requestedPotMatches = (requested, id) => {
  const n = requested.trim().toLowerCase()
  const i = (id ?? '').trim().toLowerCase()
  return Boolean(n && i) && (i === n || (n.length >= 8 && i.startsWith(n)))
}

function startMockNest(config = {}) {
  const attaches = new Map()
  const createBodies = []
  const calls = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    const url = new URL(req.url, 'http://mock')
    calls.push(`${req.method} ${url.pathname}`)
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    const fail = (status, code, message) => send(status, { statusCode: status, code, message })
    const path = url.pathname.replace(/^\/api/, '')
    const m = path.match(/^\/wallet\/pots\/attach\/([^/]+)(?:\/(client|approve|credentials))?$/)

    if (req.method === 'POST' && path === '/wallet/pots/attach') {
      createBodies.push(body)
      const requestedPotId = typeof body.potId === 'string' && POT_ID_SHAPE.test(body.potId.trim()) ? body.potId.trim() : null
      // pots-attach.service.ts:128-134
      if (body.spendMode === 'auth_required' && !requestedPotId) {
        return fail(400, 'AGENT_POT_ATTACH_POT_REQUIRED', 'Auth-required attach must name the pot. Send potId.')
      }
      const requestId = randomUUID()
      const deviceCode = `mock_device_${randomBytes(12).toString('hex')}`
      secrets.add(deviceCode)
      attaches.set(requestId, {
        requestId, deviceCode, userCode: 'MOCK-CODE', spendMode: body.spendMode ?? null,
        label: body.label ?? null, requestedPotId, status: 'pending', potId: null,
      })
      // pots-attach.service.ts:2574-2578 (attachApproveUrl adds &pot=)
      const echo = config.echoPot === false ? null : requestedPotId
      return send(201, {
        requestId, deviceCode,
        approveUrl: `http://localhost:3000/?panel=pots&attach=${requestId}${echo ? `&pot=${encodeURIComponent(echo)}` : ''}`,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        spendMode: body.spendMode ?? null,
      })
    }
    if (req.method === 'GET' && path === '/wallet/pots') return send(200, { pots: OWNED_POTS })
    if (!m) return fail(404, 'NOT_FOUND', 'mock route not found')
    const row = attaches.get(m[1])
    if (!row) return fail(404, 'AGENT_POT_ATTACH_NOT_FOUND', 'Attach request not found.')
    const identity = () => ({
      status: row.status, requestId: row.requestId, spendMode: row.spendMode,
      label: row.label, agentRef: null, sparkAddress: null, requestedPotId: row.requestedPotId,
    })

    if (req.method === 'GET' && !m[2]) {
      // pots-attach.service.ts:552-593 + controller forPublicPoll
      if (row.status === 'pending') return send(200, identity())
      return send(200, { status: row.status, requestId: row.requestId, spendMode: row.spendMode, potId: row.potId })
    }
    if (req.method === 'GET' && m[2] === 'client') {
      // pots-attach.service.ts:597-610 -> identityPoll 2289-2311 (includes userCode, requestedPotId)
      return send(200, { ...identity(), userCode: row.userCode })
    }
    if (req.method === 'POST' && m[2] === 'approve') {
      if (body.userCode !== row.userCode) return fail(401, 'AGENT_POT_USER_CODE_INVALID', 'That code is not valid.')
      if (row.status !== 'pending') return fail(409, 'AGENT_POT_ATTACH_USED', 'This attach code was already used.')
      const existing = OWNED_POTS.find((p) => p.id === body.existingPotId)
      const mode = body.spendMode ?? row.spendMode
      // pots-attach.service.ts:905-915
      if (row.spendMode === 'auth_required' && mode !== 'auth_required') {
        return fail(400, 'AGENT_POT_ATTACH_MODE_MISMATCH', 'An auth-required pairing cannot be changed to free.')
      }
      // pots-attach.service.ts:917-929
      if (row.requestedPotId && !requestedPotMatches(row.requestedPotId, body.existingPotId)) {
        return fail(400, 'AGENT_POT_ATTACH_POT_REQUIRED', 'This pairing names a pot. Approve that pot.')
      }
      // pots-attach.service.ts:934 requireOwnedPot / 948-953 spend mode
      if (!existing) return fail(404, 'AGENT_POT_NOT_FOUND', 'Pot not found.')
      if (existing.spendMode !== mode) return fail(400, 'AGENT_POT_ATTACH_MODE_MISMATCH', 'That pot is in a different spend mode.')
      row.status = 'approved'
      row.potId = config.bindOtherPot ? POT_B : existing.id // bindOtherPot simulates a misbehaving server
      return send(200, { pot: OWNED_POTS.find((p) => p.id === row.potId), spendMode: mode, origin: 'user' })
    }
    if (req.method === 'POST' && m[2] === 'credentials') {
      if (req.headers['x-zappi-device-code'] !== row.deviceCode) return fail(401, 'AGENT_POT_DEVICE_CODE_INVALID', 'bad device code')
      const potClientToken = `zpc_mock_${randomBytes(12).toString('hex')}`
      secrets.add(potClientToken)
      return send(200, { status: row.status, requestId: row.requestId, potId: row.potId, grantId: 'grant_mock_1', potClientToken })
    }
    return fail(404, 'NOT_FOUND', 'mock route not found')
  })
  return new Promise((resolveStart) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolveStart({ base: `http://127.0.0.1:${port}`, attaches, createBodies, calls, close: () => server.close() })
    })
  })
}

/* ------------------------------ web /pair step ----------------------------- */

/** Mirrors normalizeAttachPoll's naming fields (lib/api/pots-types.ts:1300-1316). */
const normalizePoll = (raw) => ({ ...raw, proposedSpendMode: raw.proposedSpendMode ?? raw.spendMode ?? null, requestedPotId: raw.requestedPotId ?? null })

/** Naming branch of pot-attach-page.tsx (ceremony=true) using the web's own helpers. */
function renderPair(rawPoll, linkPotId, pots) {
  const poll = normalizePoll(rawPoll)
  const assignable = web.potsAssignableOnAttach(pots)
  const resolvedPotId = linkPotId?.trim() || poll.requestedPotId?.trim() || ''
  const linkNamesPot = Boolean(resolvedPotId)
  const namedPot = linkNamesPot ? web.matchAssignablePot(assignable, resolvedPotId) : null
  const mcpGrantChoosePot = web.attachRequiresExistingPotChoice(poll, linkPotId)
  const legacyFreeAttach = web.isLegacyFreeAttachPoll(poll, linkPotId)
  if (!namedPot && !legacyFreeAttach && !mcpGrantChoosePot) {
    return { deadEnd: true, title: linkNamesPot ? copy.POTS_PAIR_UNKNOWN_TITLE : copy.POTS_PAIR_UNNAMED_TITLE, actions: ['Deny'] }
  }
  return {
    deadEnd: false,
    pairLabel: namedPot?.label?.trim() || copy.POTS_UNTITLED,
    potId: namedPot?.id ?? null,
    modeConflict: web.attachModeConflicts(poll.proposedSpendMode, namedPot?.spendMode ?? null),
    actions: ['Approve', 'Deny'],
  }
}

async function json(base, path, init) {
  const res = await fetch(`${base}/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  return { status: res.status, body: await res.json() }
}

/* -------------------------------- CLI runner ------------------------------- */

function runCopied(command, { base, box, extraEnv = {} }) {
  const env = {
    PATH: `${box.bin}:${process.env.PATH}`,
    HOME: box.home,
    ZAPPI_HOME: box.home,
    ZAPPI_API_URL: base,
    ZAPPI_APP_ORIGIN: 'http://localhost:3000',
    ZAPPI_ACCESS_TOKEN: 'mock-session-jwt',
    NO_COLOR: '1',
    ...extraEnv,
  }
  const child = spawn('/bin/sh', ['-c', command], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (c) => { stdout += c })
  child.stderr.on('data', (c) => { stderr += c })
  const done = new Promise((r) => child.on('close', (code) => r({ code, stdout, stderr })))
  return { done }
}

const until = async (fn, ms = 10_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)) }
  throw new Error('timeout')
}
const assertNoSecrets = (text) => { for (const s of secrets) assert.equal(text.includes(s), false, 'secret leaked to CLI output') }
/** ZAPPI_HOME is the CLI's ~/.zappi directory. */
const tokenFiles = (zappiHome) => readdirSync(zappiHome).filter((f) => f.startsWith('pot-client-'))
const firstLine = (s) => s.trim().split('\n').filter(Boolean).slice(-1)[0] ?? ''

/* --------------------------------- cases ---------------------------------- */

log('# Linear 1-554 E2E proof: copied command -> CLI attach -> mock Nest -> /pair names the pot')
log(`date: ${new Date().toISOString()}`)
log(`cli: ${CLI_ROOT} (zappi-cli ${JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8')).version}, branch build)`)
log(`web helpers: ${WEB_LIB}/lib/pots/{pairing-identity,copy}.ts`)
log('')

// Case 1: happy path, exact web copy string.
{
  const nest = await startMockNest()
  const box = freshBox()
  const command = WEB_COPY(POT_A)
  log('## 1. Happy path (exact web copy)')
  log(`copied: ${command}`)
  const run = runCopied(command, { base: nest.base, box })
  await until(() => nest.createBodies.length === 1)
  const [requestId] = nest.attaches.keys()
  log(`attach-start body recorded by mock Nest: ${JSON.stringify(nest.createBodies[0])}`)
  assert.deepEqual(nest.createBodies[0], { spendMode: 'auth_required', potId: POT_A })

  await until(() => existsSync(join(box.dir, 'opened.txt')))
  const opened = readFileSync(join(box.dir, 'opened.txt'), 'utf8').trim()
  const linkPot = new URL(opened).searchParams.get('pot')
  log(`pairing link the CLI opened: ${opened.replace(requestId, '<requestId>')}`)
  assert.equal(linkPot, POT_A)
  assert.equal(opened.includes('code='), false)

  const client = await json(nest.base, `/wallet/pots/attach/${requestId}/client`)
  const pots = await json(nest.base, '/wallet/pots')
  log(`/pair lookup (GET /attach/:id/client): ${JSON.stringify({ status: client.body.status, spendMode: client.body.spendMode, requestedPotId: client.body.requestedPotId })}`)
  const view = renderPair(client.body, linkPot, pots.body.pots)
  log(`/pair render (web helpers): ${JSON.stringify(view)}`)
  assert.equal(view.deadEnd, false)
  assert.equal(view.pairLabel, 'Research bot')
  assert.equal(view.potId, POT_A)
  assert.deepEqual(view.actions, ['Approve', 'Deny'])
  const viewNoLink = renderPair(client.body, null, pots.body.pots)
  log(`/pair render without link pot= (poll.requestedPotId only): pairLabel=${viewNoLink.pairLabel}`)
  assert.equal(viewNoLink.pairLabel, 'Research bot')

  const approve = await json(nest.base, `/wallet/pots/attach/${requestId}/approve`, {
    method: 'POST', body: JSON.stringify({ userCode: client.body.userCode, existingPotId: view.potId, spendMode: 'auth_required' }),
  })
  log(`mock approve (existingPotId=${view.potId}): HTTP ${approve.status}`)
  assert.equal(approve.status, 200)
  const result = await run.done
  assertNoSecrets(result.stdout + result.stderr)
  log(`CLI exit=${result.code}; stdout: ${result.stdout.split('\n').filter((l) => /Status:|pot |clientToken/.test(l)).map((l) => l.trim().split(box.home).join('<ZAPPI_HOME>')).join(' | ')}`)
  assert.equal(result.code, 0)
  assert.match(result.stdout, /Status: approved/)
  assert.match(result.stdout, new RegExp(`pot\\s+${POT_A}`))
  assert.equal(tokenFiles(box.home).length, 1)
  log(`pot client token stored as host secret file: yes (value withheld); deviceCode/zpc_ in CLI output: no`)
  log('')
  nest.close()
}

// Case 2: the old web copy (no pot) is refused before Nest.
{
  const nest = await startMockNest()
  const box = freshBox()
  log('## 2. Old copy without a pot is refused (no Nest call)')
  const legacy = OLD_WEB_COPY.replace('npx @zappimoney/zappi-cli', 'zappi-cli')
  log(`copied (old row, npx stripped so it runs this branch): ${legacy}`)
  const r = await runCopied(legacy, { base: nest.base, box }).done
  log(`CLI exit=${r.code}; stderr: ${firstLine(r.stderr)}`)
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /must name the pot/)
  assert.equal(nest.createBodies.length, 0)
  log(`attach-start calls: ${nest.createBodies.length}`)
  log('')
  nest.close()
}

// Case 3: --pot and ZAPPI_POT_ID disagree.
{
  const nest = await startMockNest()
  const box = freshBox()
  log('## 3. --pot vs ZAPPI_POT_ID mismatch fails closed (no Nest call)')
  const r = await runCopied(WEB_COPY(POT_A), { base: nest.base, box, extraEnv: { ZAPPI_POT_ID: POT_B } }).done
  log(`env ZAPPI_POT_ID=${POT_B}; CLI exit=${r.code}; stderr: ${firstLine(r.stderr)}`)
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /Conflicting pot selectors/)
  assert.equal(nest.createBodies.length, 0)
  log(`attach-start calls: ${nest.createBodies.length}`)
  log('')
  nest.close()
}

// Case 4: Nest that does not echo the pot -> no link printed.
{
  const nest = await startMockNest({ echoPot: false })
  const box = freshBox()
  log('## 4. Nest response does not echo the pot -> no link, no device code stored')
  const r = await runCopied(WEB_COPY(POT_A), { base: nest.base, box }).done
  assertNoSecrets(r.stdout + r.stderr)
  log(`CLI exit=${r.code}; stderr: ${firstLine(r.stderr)}; link opened: ${existsSync(join(box.dir, 'opened.txt'))}`)
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /did not confirm pot/)
  assert.equal(existsSync(join(box.dir, 'opened.txt')), false)
  assert.equal(r.stdout.includes('http'), false)
  log('')
  nest.close()
}

// Case 5: approval binds a different pot -> CLI refuses to reclaim.
{
  const nest = await startMockNest({ bindOtherPot: true })
  const box = freshBox()
  log('## 5. Approval bound a different pot -> CLI refuses, no token stored')
  const run = runCopied(WEB_COPY(POT_A), { base: nest.base, box })
  await until(() => nest.createBodies.length === 1)
  const [requestId] = nest.attaches.keys()
  const client = await json(nest.base, `/wallet/pots/attach/${requestId}/client`)
  await json(nest.base, `/wallet/pots/attach/${requestId}/approve`, {
    method: 'POST', body: JSON.stringify({ userCode: client.body.userCode, existingPotId: POT_A, spendMode: 'auth_required' }),
  })
  const r = await run.done
  assertNoSecrets(r.stdout + r.stderr)
  log(`CLI exit=${r.code}; stderr: ${firstLine(r.stderr)}`)
  assert.notEqual(r.code, 0)
  assert.match(r.stderr, /approved for a different pot/)
  assert.equal(nest.calls.some((c) => c.endsWith('/credentials')), false)
  assert.equal(tokenFiles(box.home).length, 0)
  log(`credentials reclaim called: no; token files: ${tokenFiles(box.home).length}`)
  log('')
  nest.close()
}

// Case 6: Nest rules mirrored by the mock (evidence for Server Dev).
{
  const nest = await startMockNest()
  log('## 6. Nest rules (mock mirrors pots-attach.service.ts)')
  const noPot = await json(nest.base, '/wallet/pots/attach', { method: 'POST', body: JSON.stringify({ spendMode: 'auth_required' }) })
  log(`create auth_required without potId: HTTP ${noPot.status} ${noPot.body.code}`)
  assert.equal(noPot.body.code, 'AGENT_POT_ATTACH_POT_REQUIRED')
  const created = await json(nest.base, '/wallet/pots/attach', { method: 'POST', body: JSON.stringify({ spendMode: 'auth_required', potId: POT_A }) })
  const id = created.body.requestId
  const client = await json(nest.base, `/wallet/pots/attach/${id}/client`)
  const wrongPot = await json(nest.base, `/wallet/pots/attach/${id}/approve`, {
    method: 'POST', body: JSON.stringify({ userCode: client.body.userCode, existingPotId: POT_B, spendMode: 'auth_required' }),
  })
  log(`approve a different pot than requested: HTTP ${wrongPot.status} ${wrongPot.body.code}`)
  assert.equal(wrongPot.body.code, 'AGENT_POT_ATTACH_POT_REQUIRED')
  const toFree = await json(nest.base, `/wallet/pots/attach/${id}/approve`, {
    method: 'POST', body: JSON.stringify({ userCode: client.body.userCode, existingPotId: POT_A, spendMode: 'free' }),
  })
  log(`approve with spendMode changed to free: HTTP ${toFree.status} ${toFree.body.code}`)
  assert.equal(toFree.body.code, 'AGENT_POT_ATTACH_MODE_MISMATCH')
  log('')
  nest.close()
}

// Case 7: original bug for contrast (/pair with no pot named).
{
  log('## 7. Contrast: the original bug (attach with no pot) on /pair')
  const unnamed = renderPair({ status: 'pending', requestId: 'r0', spendMode: 'auth_required', requestedPotId: null }, null, OWNED_POTS)
  log(`/pair render: ${JSON.stringify(unnamed)}`)
  assert.equal(unnamed.deadEnd, true)
  assert.equal(unnamed.title, copy.POTS_PAIR_UNNAMED_TITLE)
  log('')
}

log('RESULT: PASS (7/7)')
for (const dir of boxes) rmSync(dir, { recursive: true, force: true })
writeFileSync(join(CLI_ROOT, 'proof/1-554-attach-names-pot.txt'), `${lines.join('\n')}\n`)

/* helpers defined late to keep the cases readable */
function sandboxFiles(box) {
  writeFileSync(join(box.bin, 'zappi-cli'), `#!/bin/sh\nexec node "${join(CLI_ROOT, 'bin/cli.js')}" "$@"\n`)
  writeFileSync(join(box.bin, 'open'), `#!/bin/sh\necho "$@" >> "${join(box.dir, 'opened.txt')}"\n`)
  writeFileSync(join(box.bin, 'xdg-open'), `#!/bin/sh\necho "$@" >> "${join(box.dir, 'opened.txt')}"\n`)
  for (const f of ['zappi-cli', 'open', 'xdg-open']) chmodSync(join(box.bin, f), 0o755)
  return box
}
/** Temp HOME + PATH shims: `zappi-cli` is this branch's real bin; `open` is captured so no browser starts. */
function freshBox() {
  const dir = mkdtempSync(join(tmpdir(), 'zappi-1554-'))
  boxes.push(dir)
  const box = { dir, bin: join(dir, 'bin'), home: join(dir, 'home') }
  mkdirSync(box.bin, { recursive: true })
  mkdirSync(box.home, { recursive: true })
  return sandboxFiles(box)
}
