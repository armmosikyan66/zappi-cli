import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertCreateNamesPot,
  assertPollKeepsPot,
  potIdMatches,
  resolveAttachPotId,
} from './attach-pot.js'

const POT = 'f7b81134-3b01-49de-b114-ad433cb3bbac'
const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const link = (pot?: string) =>
  `https://dev.zappi.money/?panel=pots&attach=r1${pot ? `&pot=${pot}` : ''}`

describe('resolveAttachPotId', () => {
  it('takes --pot, ZAPPI_POT_ID, or both when they agree', () => {
    assert.equal(resolveAttachPotId({ flag: POT }), POT)
    assert.equal(resolveAttachPotId({ env: ` ${POT} ` }), POT)
    assert.equal(resolveAttachPotId({ flag: POT, env: POT.toUpperCase() }), POT)
    assert.equal(resolveAttachPotId({}), null)
  })

  it('fails closed on disagreement, a bare flag, or a malformed value', () => {
    assert.throws(() => resolveAttachPotId({ flag: POT, env: OTHER }), /Conflicting pot selectors/)
    assert.throws(() => resolveAttachPotId({ flag: true }), /--pot needs a pot id/)
    assert.throws(() => resolveAttachPotId({ flag: 'not-a-pot' }), /--pot is not a pot id/)
    assert.throws(() => resolveAttachPotId({ env: 'not-a-pot' }), /ZAPPI_POT_ID is not a pot id/)
  })
})

describe('potIdMatches', () => {
  it('matches the full id or an 8+ character prefix', () => {
    assert.equal(potIdMatches(POT, POT), true)
    assert.equal(potIdMatches(POT.slice(0, 8), POT), true)
    assert.equal(potIdMatches(POT, OTHER), false)
    assert.equal(potIdMatches(POT, null), false)
  })
})

describe('assertCreateNamesPot', () => {
  it('passes when the link or a body field echoes the pot', () => {
    assertCreateNamesPot({ approveUrl: link(POT) }, POT)
    assertCreateNamesPot({ approveUrl: link(), requestedPotId: POT }, POT)
  })

  it('fails when nothing names the pot or anything names another', () => {
    assert.throws(() => assertCreateNamesPot({ approveUrl: link() }, POT), /did not confirm/)
    assert.throws(() => assertCreateNamesPot({ approveUrl: link(OTHER) }, POT), /different pot/)
    assert.throws(
      () => assertCreateNamesPot({ approveUrl: link(POT), requestedPotId: OTHER }, POT),
      /different pot/,
    )
  })
})

describe('assertPollKeepsPot', () => {
  it('passes for a pending request on the pot and an approval that bound it', () => {
    assertPollKeepsPot({ status: 'pending', requestedPotId: POT }, POT)
    assertPollKeepsPot({ status: 'approved', potId: POT }, POT.slice(0, 8))
  })

  it('fails when the request or the approval names another pot', () => {
    assert.throws(() => assertPollKeepsPot({ status: 'pending', requestedPotId: OTHER }, POT), /different pot/)
    assert.throws(() => assertPollKeepsPot({ status: 'approved', potId: OTHER }, POT), /different pot/)
    assert.throws(() => assertPollKeepsPot({ status: 'approved', potId: null }, POT), /different pot/)
  })
})
