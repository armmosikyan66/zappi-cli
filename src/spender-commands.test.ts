import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  pullAllowanceWithSpender,
  pullArgs,
  resolveSpenderBinary,
  SPENDER_BIN_ENV,
} from './spender-commands.js'

const offer = {
  allowanceId: 'ab'.repeat(16),
  ownerPublicKey: `02${'cd'.repeat(32)}`,
  tokenIdentifier: 'ef'.repeat(32),
  receiverPublicKey: `03${'11'.repeat(32)}`,
  tokenAmount: '1000000',
}

describe('allowance spender command', () => {
  it('uses the configured binary and the pull flags', () => {
    assert.equal(resolveSpenderBinary({}), 'zappi-allowance-spender')
    assert.equal(
      resolveSpenderBinary({ [SPENDER_BIN_ENV]: '/opt/zappi-allowance-spender' }),
      '/opt/zappi-allowance-spender',
    )
    const args = pullArgs(offer)
    assert.deepEqual(args, [
      'pull',
      '--allowance-id',
      offer.allowanceId,
      '--owner-public-key',
      offer.ownerPublicKey,
      '--token-identifier',
      offer.tokenIdentifier,
      '--receiver-public-key',
      offer.receiverPublicKey,
      '--amount',
      '1000000',
    ])
  })

  it('returns the transaction id and strips parent secrets from the child env', async () => {
    let seenEnv: NodeJS.ProcessEnv = {}
    const txId = await pullAllowanceWithSpender(offer, async (_command, _args, env) => {
      seenEnv = env
      return { code: 0, stdout: 'tx-1\n', stderr: '' }
    }, { ZAPPI_ACCESS_TOKEN: 'secret', PATH: '/usr/bin' })
    assert.equal(txId, 'tx-1')
    assert.equal(seenEnv.ZAPPI_ACCESS_TOKEN, undefined)
    assert.equal(seenEnv.PATH, '/usr/bin')
  })
})
