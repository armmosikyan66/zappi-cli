import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { omitArchivedPots } from './pots-commands.js'

describe('omitArchivedPots', () => {
  it('drops pots the server has archived', () => {
    const pots = omitArchivedPots([
      { id: 'active', archivedAt: null },
      { id: 'hidden', archivedAt: '2026-11-02T00:00:00.000Z' },
      { id: 'legacy' },
    ])
    assert.deepEqual(
      pots.map((pot) => pot.id),
      ['active', 'legacy'],
    )
  })
})
