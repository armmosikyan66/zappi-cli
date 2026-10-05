import { toString as qrToString } from 'qrcode'

/** Unicode half-block QR. Scans from a terminal; no ANSI colors required. */
export async function renderTerminalQr(payload: string): Promise<string> {
  const text = payload.trim()
  if (!text) throw new Error('Cannot draw a QR for an empty deposit address.')
  const art = await qrToString(text, {
    type: 'utf8',
    errorCorrectionLevel: 'M',
    // Even margin. The utf8 renderer divides it by two, and an odd value throws.
    margin: 4,
  })
  return art.replace(/\s+$/u, '')
}
