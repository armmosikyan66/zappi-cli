import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatDepositCard, potDepositQrPayload } from './deposit-view.js'
import { renderTerminalQr } from './terminal-qr.js'

const SOLANA = 'So11111111111111111111111111111111111111112'

describe('potDepositQrPayload', () => {
  it('keeps an unknown rail as the raw address', () => {
    assert.equal(
      potDepositQrPayload({ depositAddress: '0xabc' }),
      '0xabc',
    )
  })

  it('encodes USDC on Solana as the address itself', () => {
    assert.equal(
      potDepositQrPayload({
        depositAddress: SOLANA,
        sourceAsset: 'USDC',
        sourceChain: 'solana',
      }),
      SOLANA,
    )
  })

  it('prefixes Tron USDT', () => {
    assert.equal(
      potDepositQrPayload({
        depositAddress: 'TXYZ',
        sourceAsset: 'USDT',
        sourceChain: 'tron',
      }),
      'tron:TXYZ',
    )
  })

  it('prefixes Bitcoin', () => {
    assert.equal(
      potDepositQrPayload({
        depositAddress: 'bc1qtest',
        sourceAsset: 'BTC',
        sourceChain: 'bitcoin',
      }),
      'bitcoin:bc1qtest',
    )
  })

  it('throws when the address is missing', () => {
    assert.throws(
      () => potDepositQrPayload({ depositAddress: '  ' }),
      /did not include an address/,
    )
  })
})

describe('formatDepositCard', () => {
  it('prints the address on its own line and a QR in pretty mode', async () => {
    const out = await formatDepositCard(
      {
        title: 'Pot deposit address',
        address: SOLANA,
        qrPayload: SOLANA,
        fields: [
          ['pot', 'p1'],
          ['asset', 'USDC'],
          ['network', 'solana'],
        ],
      },
      'pretty',
    )
    assert.match(out, /^address$/m)
    assert.match(out, new RegExp(`^${SOLANA}$`, 'm'))
    assert.match(out, /[█▀▄]/)
    assert.match(out, /USDC/)
    assert.match(out, /solana/)
  })

  it('omits the QR in plain mode', async () => {
    const out = await formatDepositCard(
      {
        title: 'Deposit address',
        address: '0xabc',
        qrPayload: '0xabc',
        fields: [['asset', 'usdc']],
      },
      'plain',
    )
    assert.match(out, /^0xabc$/m)
    assert.doesNotMatch(out, /[█▀▄]/)
  })
})

describe('renderTerminalQr', () => {
  it('draws a multi-line block QR', async () => {
    const art = await renderTerminalQr('0xabc')
    assert.ok(art.split('\n').length > 4)
    assert.match(art, /[█▀▄]/)
  })

  it('refuses an empty payload', async () => {
    await assert.rejects(() => renderTerminalQr('  '), /empty deposit address/)
  })
})
