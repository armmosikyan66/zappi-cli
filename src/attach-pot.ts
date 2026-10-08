/**
 * Which pot a `pots attach` pairing names (Linear 1-554).
 *
 * The approve page can only offer "Approve" for a pot it can name. An
 * auth-required pairing that reaches Nest without a pot dead-ends on /pair
 * with Deny as the only option, so the CLI resolves the pot before it calls
 * Nest and checks that Nest echoed the same pot before it prints a link.
 *
 * Pot ids are public. Values that are not pot-id shaped are never echoed back,
 * because a mistaken paste could be a secret.
 */

/** Full UUID, or a hex prefix of at least 8 characters (same rule as Nest). */
const POT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const POT_ID_PREFIX = /^[0-9a-f]{8,32}$/i

export const ATTACH_COMMAND_SHAPE =
  'zappi-cli pots attach --pot <potId> --spend-mode auth_required'

export const ATTACH_POT_REQUIRED_ERROR =
  `Auth-required attach must name the pot. Run \`${ATTACH_COMMAND_SHAPE}\` (or set ZAPPI_POT_ID). Do not print a link without it.`

/** Trimmed pot id when the value is pot-id shaped, else null. */
export function publicPotId(value: string | undefined | null): string | null {
  const id = value?.trim() ?? ''
  if (POT_UUID.test(id) || POT_ID_PREFIX.test(id)) return id
  return null
}

/**
 * Nest's approve rule: the approved pot is the named pot, or the only id
 * that starts with a named prefix of at least 8 characters.
 */
export function potIdMatches(requested: string, actual: string | null | undefined): boolean {
  const needle = requested.trim().toLowerCase()
  const id = actual?.trim().toLowerCase() ?? ''
  if (!needle || !id) return false
  if (id === needle) return true
  return needle.length >= 8 && id.startsWith(needle)
}

export interface AttachPotSelectors {
  /** `--pot <potId>`. `true` when the flag was given without a value. */
  flag?: string | boolean
  /** `ZAPPI_POT_ID`. */
  env?: string
}

/**
 * Resolve the pot from `--pot` and `ZAPPI_POT_ID`. Either may be used; when
 * both are set they must name the same pot. A malformed value fails closed
 * instead of being dropped, so a typo can never produce an unnamed pairing.
 */
export function resolveAttachPotId(selectors: AttachPotSelectors): string | null {
  if (selectors.flag === true) {
    throw new Error(`--pot needs a pot id. Usage: ${ATTACH_COMMAND_SHAPE}`)
  }
  const rawFlag = typeof selectors.flag === 'string' ? selectors.flag.trim() : ''
  const rawEnv = selectors.env?.trim() ?? ''
  const fromFlag = rawFlag ? publicPotId(rawFlag) : null
  const fromEnv = rawEnv ? publicPotId(rawEnv) : null
  if (rawFlag && !fromFlag) {
    throw new Error('--pot is not a pot id. Use the pot UUID shown in Zappi.')
  }
  if (rawEnv && !fromEnv) {
    throw new Error('ZAPPI_POT_ID is not a pot id. Use the pot UUID shown in Zappi.')
  }
  if (fromFlag && fromEnv && fromFlag.toLowerCase() !== fromEnv.toLowerCase()) {
    throw new Error(
      `Conflicting pot selectors: --pot ${fromFlag} but ZAPPI_POT_ID=${fromEnv}. Pick one.`,
    )
  }
  return fromFlag ?? fromEnv
}

/** Fields of an attach create response that can name the pot. */
export interface AttachCreateEcho {
  approveUrl: string
  requestedPotId?: unknown
  potId?: unknown
}

/** Pot Nest names on an attach create response: a body field or the approve link's `pot=`. */
function potsNamedByCreate(pending: AttachCreateEcho): string[] {
  const named: string[] = []
  for (const key of ['requestedPotId', 'potId'] as const) {
    const value = pending[key]
    if (typeof value === 'string' && value.trim()) named.push(value.trim())
  }
  try {
    const fromLink = new URL(pending.approveUrl).searchParams.get('pot')
    if (fromLink?.trim()) named.push(fromLink.trim())
  } catch {
    // An unparseable link names no pot; the check below fails closed.
  }
  return named
}

/**
 * Nest must confirm it stored the pot this host asked for. Runs before the
 * device code is stored or any link is printed.
 */
export function assertCreateNamesPot(
  pending: AttachCreateEcho,
  requestedPotId: string,
): void {
  const named = potsNamedByCreate(pending)
  if (named.length === 0) {
    throw new Error(
      `Zappi did not confirm pot ${requestedPotId} for this pairing. No link was printed. Update Zappi or retry.`,
    )
  }
  if (!named.every((id) => id.toLowerCase() === requestedPotId.toLowerCase())) {
    throw new Error(
      `Zappi named a different pot than ${requestedPotId} for this pairing. No link was printed.`,
    )
  }
}

/**
 * During polling, a pending request must still name the requested pot and an
 * approved request must have bound it. Anything else fails closed before the
 * client token is reclaimed.
 */
export function assertPollKeepsPot(
  poll: { status: string; requestedPotId?: string | null; potId?: string | null },
  requestedPotId: string,
): void {
  const pending = poll.requestedPotId?.trim()
  if (pending && pending.toLowerCase() !== requestedPotId.toLowerCase()) {
    throw new Error(
      `This pairing now names a different pot than ${requestedPotId}. Deny it in Zappi and pair again.`,
    )
  }
  if (poll.status === 'approved' && !potIdMatches(requestedPotId, poll.potId)) {
    throw new Error(
      `Pairing was approved for a different pot than ${requestedPotId}. The client token was not stored. Deny it in Zappi and pair again.`,
    )
  }
}
