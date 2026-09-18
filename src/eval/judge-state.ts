import { redactSecrets } from '../paywall-http.js'
import { looksLikeMnemonicPhrase } from '../spark-address.js'

export type JudgeSpendMode = 'free' | 'auth_required' | 'unknown'

export type JudgeSkillId = 'zappi_agent_pot' | 'zappi_eval_harness' | 'none'

export type JudgeHandlerId =
  | 'deterministic_cli'
  | 'human_approve'
  | 'refuse'
  | 'copy_review'
  | 'none'

export type JudgeFocus = 'copy' | 'skill' | 'route'

/** Ground-truth policy the model may cite. Not a catalog of live rails. */
export interface JudgePolicyFacts {
  spendMode: JudgeSpendMode
  emptyPotIsCap: true
  disconnectStopsOnChainSpend: false
  installArgsAreNotPotId: true
  paywallNetwork: 'spark'
  paywallAsset: 'USDB'
  runtimePotIdEnv: 'ZAPPI_POT_ID'
}

export interface JudgeState {
  transcript: string
  userTurn: string | null
  policy: JudgePolicyFacts
}

export interface PrepareJudgeStateInput {
  transcript: string
  userTurn?: string
  spendMode?: JudgeSpendMode
}

const PLACEHOLDERS = [
  /zpu_\[redacted\]/g,
  /zpc_\[redacted\]/g,
  /ZAPPI_POT_SEED=\[redacted\]/g,
  /ZAPPI_UNLOCK_TOKEN=\[redacted\]/g,
  /\[redacted mnemonic\]/g,
]

const LIVE_SECRET =
  /zpu_[A-Za-z0-9]+|zpc_[A-Za-z0-9_-]+|ZAPPI_POT_SEED=\S+|ZAPPI_UNLOCK_TOKEN=\S+/

export function stripJudgePlaceholders(text: string): string {
  return PLACEHOLDERS.reduce((value, pattern) => value.replace(pattern, ' '), text)
}

/** Fail closed: TypeSafe never sees a live seed/token/mnemonic. */
export function assertSafeForJudge(text: string): void {
  const stripped = stripJudgePlaceholders(text)
  if (LIVE_SECRET.test(stripped)) {
    throw new Error(
      'Judge state still contains a live secret after redaction. Do not send unredacted transcripts to TypeSafe.',
    )
  }
  if (looksLikeMnemonicPhrase(stripped)) {
    throw new Error(
      'Judge state still contains a mnemonic-shaped phrase. Redact before TypeSafe.',
    )
  }
}

export function prepareJudgeState(input: PrepareJudgeStateInput): JudgeState {
  const transcript = redactSecrets(input.transcript)
  assertSafeForJudge(transcript)
  const userTurn = input.userTurn?.trim() ? redactSecrets(input.userTurn) : null
  if (userTurn) assertSafeForJudge(userTurn)
  return {
    transcript,
    userTurn,
    policy: {
      spendMode: input.spendMode ?? 'unknown',
      emptyPotIsCap: true,
      disconnectStopsOnChainSpend: false,
      installArgsAreNotPotId: true,
      paywallNetwork: 'spark',
      paywallAsset: 'USDB',
      runtimePotIdEnv: 'ZAPPI_POT_ID',
    },
  }
}
