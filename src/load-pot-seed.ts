import { readFileSync } from 'node:fs'

export interface PotSeedEnv {
  ZAPPI_POT_SEED?: string
  ZAPPI_POT_KEY_FILE?: string
}

/**
 * Load the pot spend key from the host secret or a 0600 file.
 * Callers must not log, print, or interpolate the return value.
 */
export function loadPotSeed(env: PotSeedEnv = process.env): string {
  const fromEnv = env.ZAPPI_POT_SEED?.trim()
  if (fromEnv) {
    if (fromEnv.startsWith('<') && fromEnv.endsWith('>')) {
      throw new Error(
        'ZAPPI_POT_SEED is still a placeholder. Set the host secret — do not paste it into chat.',
      )
    }
    return fromEnv
  }

  const file = env.ZAPPI_POT_KEY_FILE?.trim()
  if (!file) {
    throw new Error(
      'Set ZAPPI_POT_SEED or ZAPPI_POT_KEY_FILE. Do not paste the pot key into chat.',
    )
  }

  const phrase = extractPhraseFromKeyFile(readFileSync(file, 'utf8'))
  if (!phrase) {
    throw new Error('Pot key file did not contain a recovery phrase.')
  }
  return phrase
}

/** Last non-comment, non-label line in the downloaded zappi-pot-*.txt format. */
export function extractPhraseFromKeyFile(text: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line || line.startsWith('#') || line.includes(':')) continue
    const words = line.split(/\s+/).filter(Boolean)
    if (words.length >= 12 && words.length <= 24) return line
  }
  return null
}
