import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it, afterEach } from 'node:test'
import { runCli, writeCliFailure } from './cli.js'
import {
  forwardedSignerExitCode,
  SIGNER_BIN_ENV,
  type SignerChild,
  type SignerSpawn,
} from './signer-commands.js'

interface SpawnCall {
  command: string
  args: readonly string[]
  stdio: string
}

const savedSignerBin = process.env[SIGNER_BIN_ENV]

afterEach(() => {
  if (savedSignerBin === undefined) delete process.env[SIGNER_BIN_ENV]
  else process.env[SIGNER_BIN_ENV] = savedSignerBin
})

function deferredChild(
  settle: (emit: (event: 'error' | 'exit', ...args: unknown[]) => void) => void,
): SignerChild {
  const emitter = new EventEmitter()
  queueMicrotask(() => {
    settle((event, ...args) => {
      emitter.emit(event, ...args)
    })
  })
  return {
    once(event, listener) {
      emitter.once(event, listener)
    },
  }
}

function recordingSpawn(exitCode = 0): { spawn: SignerSpawn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = []
  const spawn: SignerSpawn = (command, args, options) => {
    calls.push({ command, args, stdio: options.stdio })
    return deferredChild((emit) => {
      emit('exit', exitCode, null)
    })
  }
  return { spawn, calls }
}

function missingBinary(): SignerChild {
  return deferredChild((emit) => {
    const error = new Error('spawn zappi-signer ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    emit('error', error)
  })
}

describe('signer command spawn', { concurrency: 1 }, () => {
  it('spawns sign without --yes', async () => {
    const { spawn, calls } = recordingSpawn()
    const output = await runCli(['sign', 'req-1'], 'plain', { spawn })
    assert.equal(output, '')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.command, 'zappi-signer')
    assert.deepEqual(calls[0]?.args, ['sign', 'req-1'])
    assert.equal(calls[0]?.args.includes('--yes'), false)
    assert.equal(calls[0]?.stdio, 'inherit')
  })

  it('spawns sign --yes', async () => {
    const { spawn, calls } = recordingSpawn()
    await runCli(['sign', 'req-1', '--yes'], 'plain', { spawn })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0]?.args, ['sign', 'req-1', '--yes'])
    assert.equal(calls[0]?.stdio, 'inherit')
  })

  it('sign --yes and interactive sign both spawn the signer spend gate', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    const { spawn, calls } = recordingSpawn()
    const agent = await runCli(['sign', requestId, '--yes'], 'plain', { spawn })
    const human = await runCli(['sign', requestId], 'plain', { spawn })
    assert.equal(agent, '')
    assert.equal(human, '')
    assert.deepEqual(calls.map((call) => call.command), ['zappi-signer', 'zappi-signer'])
    assert.deepEqual(calls[0]?.args, ['sign', requestId, '--yes'])
    assert.deepEqual(calls[1]?.args, ['sign', requestId])
    assert.equal(calls[1]?.args.includes('--yes'), false)
    assert.equal(calls[0]?.stdio, 'inherit')
    assert.equal(calls[1]?.stdio, 'inherit')
    await runCli(['sign', requestId, '--yes'], 'plain', { spawn })
    await runCli(['sign', requestId], 'plain', { spawn })
    assert.equal(calls.length, 4)
    assert.deepEqual(calls[2]?.args, ['sign', requestId, '--yes'])
    assert.deepEqual(calls[3]?.args, ['sign', requestId])
    for (const call of calls) {
      assert.equal(call.args.includes(requestId), true)
      assert.equal(JSON.stringify(call).includes('mnemonic'), false)
    }
  })

  it('spawns signer-status as signer status', async () => {
    const { spawn, calls } = recordingSpawn()
    await runCli(['signer-status', 'req-1', '--signer', '/opt/zappi-signer'], 'plain', { spawn })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.command, '/opt/zappi-signer')
    assert.deepEqual(calls[0]?.args, ['status', 'req-1'])
    assert.equal(calls[0]?.stdio, 'inherit')
  })

  it('missing binary names ZAPPI_SIGNER_BIN and exits non-zero', async () => {
    const spawn: SignerSpawn = () => missingBinary()
    const error = await runCli(['sign', 'req-1'], 'plain', { spawn }).then(
      () => {
        throw new Error('expected a missing signer')
      },
      (caught: unknown) => caught,
    )
    assert.ok(error instanceof Error)
    assert.match(error.message, /ZAPPI_SIGNER_BIN/)
    assert.equal(forwardedSignerExitCode(error), undefined)
    const previous = process.exitCode
    let written = ''
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      return true
    }) as typeof process.stderr.write
    try {
      writeCliFailure(error, 'plain')
      assert.equal(process.exitCode, 1)
      assert.match(written, /ZAPPI_SIGNER_BIN/)
    } finally {
      process.stderr.write = original
      process.exitCode = previous ?? 0
    }
  })

  it('spawns again for a second sign of the same request', async () => {
    const { spawn, calls } = recordingSpawn()
    await runCli(['sign', 'req-1'], 'plain', { spawn })
    await runCli(['sign', 'req-1'], 'plain', { spawn })
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0]?.args, ['sign', 'req-1'])
    assert.deepEqual(calls[1]?.args, ['sign', 'req-1'])
  })

  it('prefers --signer over ZAPPI_SIGNER_BIN and strips it from the child', async () => {
    process.env[SIGNER_BIN_ENV] = '/env/zappi-signer'
    const { spawn, calls } = recordingSpawn()
    await runCli(
      ['sign', 'req-1', '--signer', '/flag/zappi-signer', '--yes'],
      'plain',
      { spawn },
    )
    assert.equal(calls[0]?.command, '/flag/zappi-signer')
    assert.deepEqual(calls[0]?.args, ['sign', 'req-1', '--yes'])
  })

  it('uses ZAPPI_SIGNER_BIN when --signer is omitted', async () => {
    process.env[SIGNER_BIN_ENV] = '/env/zappi-signer'
    const { spawn, calls } = recordingSpawn()
    await runCli(['sign', 'req-9'], 'plain', { spawn })
    assert.equal(calls[0]?.command, '/env/zappi-signer')
    assert.deepEqual(calls[0]?.args, ['sign', 'req-9'])
  })

  it('forwards passthrough args and --yes only when the user passed it', async () => {
    const { spawn, calls } = recordingSpawn()
    await runCli(['policy', 'tighten', '--max', '10'], 'plain', { spawn })
    await runCli(
      ['provision', '--signer=/opt/zappi-signer', '--yes', '--label', 'desk'],
      'plain',
      { spawn },
    )
    await runCli(['backup', '--out', 'vault.bak'], 'plain', { spawn })
    assert.deepEqual(calls[0], {
      command: 'zappi-signer',
      args: ['policy', 'tighten', '--max', '10'],
      stdio: 'inherit',
    })
    assert.deepEqual(calls[1], {
      command: '/opt/zappi-signer',
      args: ['provision', '--yes', '--label', 'desk'],
      stdio: 'inherit',
    })
    assert.equal(calls[2]?.args.includes('--yes'), false)
    assert.deepEqual(calls[2]?.args, ['backup', '--out', 'vault.bak'])
    await runCli(['prove-address', '--address', 'addr'], 'plain', { spawn })
    await runCli(['restore'], 'plain', { spawn })
    assert.deepEqual(calls[3]?.args, ['prove-address', '--address', 'addr'])
    assert.equal(calls[4]?.args.includes('--yes'), false)
    assert.deepEqual(calls[4]?.args, ['restore'])
  })

  it('forwards the parent environment, including ZAPPI_SIGNER_API_URL', async () => {
    const previous = process.env.ZAPPI_SIGNER_API_URL
    process.env.ZAPPI_SIGNER_API_URL = 'http://127.0.0.1:3011/api'
    const calls: Array<{ env?: NodeJS.ProcessEnv }> = []
    const spawn: SignerSpawn = (_command, _args, options) => {
      calls.push({ env: options.env })
      return deferredChild((emit) => {
        emit('exit', 0, null)
      })
    }
    try {
      await runCli(['sign', 'req-1'], 'plain', { spawn })
      assert.equal(calls.length, 1)
      assert.equal(calls[0]?.env?.ZAPPI_SIGNER_API_URL, 'http://127.0.0.1:3011/api')
      assert.equal(calls[0]?.env, process.env)
    } finally {
      if (previous === undefined) delete process.env.ZAPPI_SIGNER_API_URL
      else process.env.ZAPPI_SIGNER_API_URL = previous
    }
  })

  it('forwards a non-zero signer exit code without a second error line', async () => {
    const { spawn } = recordingSpawn(3)
    const error = await runCli(['sign', 'req-1'], 'plain', { spawn }).then(
      () => {
        throw new Error('expected signer exit')
      },
      (caught: unknown) => caught,
    )
    assert.equal(forwardedSignerExitCode(error), 3)
    const previous = process.exitCode
    let written = ''
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      return true
    }) as typeof process.stderr.write
    try {
      writeCliFailure(error, 'plain')
      assert.equal(process.exitCode, 3)
      assert.equal(written, '')
    } finally {
      process.stderr.write = original
      process.exitCode = previous ?? 0
    }
  })
})
