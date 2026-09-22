import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifySendTarget } from './send-commands.js'

describe('classifySendTarget', () => {
  it('routes @user to internal', () => {
    assert.equal(classifySendTarget('@alice', {}), 'internal')
  })

  it('routes bare id without asset/network to internal', () => {
    assert.equal(classifySendTarget('user_123', {}), 'internal')
  })

  it('routes address with asset+network to external', () => {
    assert.equal(
      classifySendTarget('0xabc', { asset: 'usdc', network: 'base' }),
      'external',
    )
  })

  it('routes asset without network as external (caller must supply network)', () => {
    assert.equal(classifySendTarget('bc1q...', { asset: 'btc' }), 'external')
  })
})
