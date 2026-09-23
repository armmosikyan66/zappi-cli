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

  it('routes sparkrt1… to spark (not internal UUID)', () => {
    assert.equal(
      classifySendTarget(
        'sparkrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6h4k8p',
        {},
      ),
      'spark',
    )
  })

  it('routes spark1… to spark even when asset flags present', () => {
    assert.equal(
      classifySendTarget('spark1qabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrs', {
        asset: 'usdc',
        network: 'spark',
      }),
      'spark',
    )
  })

  it('routes address with asset+network to external', () => {
    assert.equal(
      classifySendTarget('0xabc', { asset: 'usdc', network: 'base' }),
      'external',
    )
  })

  it('routes asset without network as external (caller must supply network)', () => {
    assert.equal(classifySendTarget('bc1qabc', { asset: 'btc' }), 'external')
  })
})
