/**
 * Immutable, verified free-pot context — Linear 1-456 stage 2 / 1-458.
 *
 * Resolves pot selection once, before any signing, from `--pot`, `ZAPPI_POT_ID`,
 * the registry's active pot, `ZAPPI_POT_SEED`, and `ZAPPI_POT_KEY_FILE`, then
 * binds the seed-derived Spark address to the authoritative pot identity and
 * carries that one immutable context through balance/pay/send/settle.
 *
 * Selector precedence (documented):
 *   pot id :  --pot  >  ZAPPI_POT_ID  >  registry activePotId
 *   seed   :  registry (if pot present)  >  ZAPPI_POT_SEED  >  ZAPPI_POT_KEY_FILE
 *
 * Explicit contradictory selectors fail closed. A registry pot never falls back to
 * an env/file seed after a decrypt failure, and the env/file legacy paths are
 * explicit opt-outs — never automatic recovery from registry failure. The
 * seed-derived Spark address must match the stored identity; mismatch fails closed.
 *
 * The seed is held inside the context and reached only via `getSeed()` for in-memory
 * signing. It is never written to `process.env`, logged, or printed. Free pots only.
 */

import {
  findPotRecord,
  getActivePot,
  loadPotSeedFromRegistry,
  type PotRecord,
} from './pot-registry.js'
import {
  resolvePotPassphrase,
  resolveSparkNetwork,
  type PotEnv,
} from './env.js'
import { loadPotSeed } from './load-pot-seed.js'

export type SparkNetwork = 'MAINNET' | 'REGTEST'
export type PotDerivationMode = 'spark'
export const DEFAULT_POT_DERIVATION_MODE: PotDerivationMode = 'spark'
export const DEFAULT_POT_ACCOUNT_INDEX = 0

export type PotSeedSource = 'registry' | 'env' | 'file'

export interface PotContext {
  readonly potId: string
  readonly sparkAddress: string
  readonly spendMode: 'free'
  readonly network: SparkNetwork
  readonly derivationMode: PotDerivationMode
  readonly accountIndex: number
  readonly source: PotSeedSource
  /** Returns the seed for in-memory signing only. Never log, print, or export it. */
  getSeed: () => string
}

export interface PotContextSelectors {
  /** `--pot <id>` flag. Wins over `ZAPPI_POT_ID` and the registry active pot. */
  potFlag?: string
}

export interface PotContextDeps {
  env?: PotEnv
  /** Override the passphrase (tests). Default resolves `ZAPPI_POT_PASSPHRASE`. */
  passphrase?: string
  /** Override Spark address derivation (tests). Default uses the Spark SDK. */
  deriveAddress?: (seed: string, network: SparkNetwork, accountIndex: number) => Promise<string>
}

/**
 * Resolve one immutable, verified free-pot context. Throws (fail closed) on
 * missing/contradictory selectors, failed decrypt/auth, unknown modes, or an
 * address mismatch. Never silently falls back to another seed or pot.
 */
export async function resolvePotContext(
  selectors: PotContextSelectors = {},
  deps: PotContextDeps = {},
): Promise<PotContext> {
  const env = deps.env ?? process.env
  const potId = await resolvePotId(selectors, env, deps)

  const registryRecord = await findPotRecord(potId, { env })

  if (registryRecord) {
    return resolveRegistryContext(potId, registryRecord, env, deps)
  }

  return resolveLegacyContext(potId, env, deps)
}

/* ------------------------------- pot id select ------------------------------- */

async function resolvePotId(
  selectors: PotContextSelectors,
  env: PotEnv,
  deps: PotContextDeps,
): Promise<string> {
  const flag = selectors.potFlag?.trim()
  const envId = env.ZAPPI_POT_ID?.trim()
  if (flag && envId && flag !== envId) {
    throw new Error(
      `Conflicting pot selectors: --pot ${flag} but ZAPPI_POT_ID=${envId}. Pick one.`,
    )
  }
  const explicit = flag || envId
  if (explicit) return explicit
  // No explicit selector: use the registry's "last used" pointer. This is not a
  // silent fallback to another seed — it is the registry's own active-pot id.
  const active = await getActivePot({ env })
  if (!active) {
    throw new Error(
      'No pot selected. Pass --pot <id>, set ZAPPI_POT_ID, or run `zappi-cli pots use <id>`.',
    )
  }
  return active
}

/* ----------------------------- registry context ------------------------------ */

async function resolveRegistryContext(
  potId: string,
  record: PotRecord,
  env: PotEnv,
  deps: PotContextDeps,
): Promise<PotContext> {
  // Registry is authoritative for this pot. An env/file seed set at the same
  // time is a conflicting selector (fail closed) — we never silently prefer one.
  if (env.ZAPPI_POT_SEED?.trim() || env.ZAPPI_POT_KEY_FILE?.trim()) {
    throw new Error(
      `Pot ${potId} is in the encrypted registry but ZAPPI_POT_SEED/ZAPPI_POT_KEY_FILE is also set. Remove the env override; the registry is authoritative.`,
    )
  }
  const passphrase = deps.passphrase ?? resolvePotPassphrase(env)
  // loadPotSeedFromRegistry re-validates endpoints and the AAD tag. A decrypt
  // failure here fails closed — we do NOT fall back to env/file.
  const { seed } = await loadPotSeedFromRegistry(potId, passphrase, { env })
  const derived = await deriveAndVerifyAddress(seed, record, deps)
  return freezeContext({
    potId,
    sparkAddress: derived,
    spendMode: 'free',
    network: record.network,
    derivationMode: record.derivationMode,
    accountIndex: record.accountIndex,
    source: 'registry',
    seed,
  })
}

/* ------------------------------ legacy context ------------------------------- */

async function resolveLegacyContext(
  potId: string,
  env: PotEnv,
  deps: PotContextDeps,
): Promise<PotContext> {
  // The pot is not in the registry. ZAPPI_POT_SEED and ZAPPI_POT_KEY_FILE are
  // explicit legacy opt-outs; both set is a conflicting selector (fail closed).
  const envSeed = env.ZAPPI_POT_SEED?.trim()
  const keyFile = env.ZAPPI_POT_KEY_FILE?.trim()
  if (envSeed && keyFile) {
    throw new Error(
      'Conflicting seed sources: both ZAPPI_POT_SEED and ZAPPI_POT_KEY_FILE are set. Pick one.',
    )
  }
  if (!envSeed && !keyFile) {
    throw new Error(
      `Pot ${potId} is not in the encrypted registry and no legacy seed source is set. Run \`zappi-cli propose --generate\` or set ZAPPI_POT_SEED.`,
    )
  }
  // loadPotSeed reads env then file and applies the placeholder guard.
  const seed = loadPotSeed(env)
  const network = resolveSparkNetwork(env)
  const derivationMode: PotDerivationMode = DEFAULT_POT_DERIVATION_MODE
  const accountIndex = DEFAULT_POT_ACCOUNT_INDEX
  const derived = await (deps.deriveAddress
    ? deps.deriveAddress(seed, network, accountIndex)
    : defaultDeriveAddress(seed, network, accountIndex))
  return freezeContext({
    potId,
    sparkAddress: derived,
    spendMode: 'free',
    network,
    derivationMode,
    accountIndex,
    source: envSeed ? 'env' : 'file',
    seed,
  })
}

/* --------------------------- address verification ---------------------------- */

async function deriveAndVerifyAddress(
  seed: string,
  record: PotRecord,
  deps: PotContextDeps,
): Promise<string> {
  const derived = await (deps.deriveAddress
    ? deps.deriveAddress(seed, record.network, record.accountIndex)
    : defaultDeriveAddress(seed, record.network, record.accountIndex))
  if (derived !== record.sparkAddress) {
    throw new Error(
      `Seed-derived Spark address (${derived}) does not match the registry identity (${record.sparkAddress}). Refusing to sign — the seed does not belong to this pot.`,
    )
  }
  return derived
}

async function defaultDeriveAddress(
  seed: string,
  network: SparkNetwork,
  accountIndex: number,
): Promise<string> {
  const { SparkWallet } = await import('@buildonspark/spark-sdk')
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: seed,
    accountNumber: accountIndex,
    options: { network },
  })
  try {
    return await wallet.getSparkAddress()
  } finally {
    await wallet.cleanupConnections()
  }
}

/* ------------------------------- freeze + seed ------------------------------ */

function freezeContext(input: {
  potId: string
  sparkAddress: string
  spendMode: 'free'
  network: SparkNetwork
  derivationMode: PotDerivationMode
  accountIndex: number
  source: PotSeedSource
  seed: string
}): PotContext {
  const { seed, ...publicFields } = input
  const context: PotContext = {
    ...Object.freeze(publicFields),
    spendMode: 'free',
    getSeed: () => seed,
  }
  return Object.freeze(context) as PotContext
}
