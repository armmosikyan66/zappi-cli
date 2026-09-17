import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { select } from './wizard-io.js'

class FakeTty extends Readable {
  isTTY = true
  setRawMode() {
    return this
  }
  pause() {
    return this
  }
}

function fakeIo() {
  const stdin = new FakeTty({ read() {} })
  const chunks: string[] = []
  const stdout = new Writable({
    write(chunk: Buffer, _enc: unknown, cb: (err?: Error | null) => void) {
      chunks.push(chunk.toString())
      cb()
    },
  })
  return { stdin, stdout, chunks }
}

const OPTIONS = [
  { label: 'Generate a new pot', value: 'generate' },
  { label: 'Use an existing pot', value: 'existing' },
]

async function driveSelect(keys: string[]): Promise<{
  value: string
  rendered: string
}> {
  const { stdin, stdout, chunks } = fakeIo()
  const { select } = await import('./wizard-io.js')
  const pending = select('Pick:', OPTIONS, { stdin, stdout })
  for (const key of keys) stdin.push(key)
  const value = await pending
  return { value, rendered: chunks.join('') }
}

describe('select (arrow-key menu)', () => {
  it('defaults to the first option and ENTER selects it', async () => {
    const { value, rendered } = await driveSelect(['\r'])
    assert.equal(value, 'generate')
    assert.match(rendered, /◉ Generate a new pot/)
    assert.match(rendered, /^○ Use an existing pot/m)
    assert.match(rendered, /↑\/↓ to move/)
  })

  it('↓ then ENTER selects the second option', async () => {
    const { value } = await driveSelect(['\x1b[B', '\r'])
    assert.equal(value, 'existing')
  })

  it('↑ wraps around to the last option', async () => {
    const { value } = await driveSelect(['\x1b[A', '\r'])
    assert.equal(value, 'existing')
  })

  it('j/k vim keys work', async () => {
    const down = await driveSelect(['j', '\r'])
    assert.equal(down.value, 'existing')
    const up = await driveSelect(['j', 'k', '\r'])
    assert.equal(up.value, 'generate')
  })

  it('digit 2 selects the second option directly', async () => {
    const { value } = await driveSelect(['2'])
    assert.equal(value, 'existing')
  })
})
