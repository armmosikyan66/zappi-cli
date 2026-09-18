import type { SystemOneResult } from '@typesafe-ai/sdk'
import type {
  JudgeFocus,
  JudgeHandlerId,
  JudgeSkillId,
  JudgeSpendMode,
} from './judge-state.js'
import type { HybridEvalQuestions } from './typesafe-questions.js'

export type HybridEvalAnswers = SystemOneResult<HybridEvalQuestions>['answers']

export type JudgeVerdict = 'pass' | 'fail' | 'review'

export interface JudgeDecision {
  verdict: JudgeVerdict
  reasons: string[]
}

export interface CopyExpect {
  disconnectLie?: boolean
  installAsPot?: boolean
  secretLeak?: boolean
  requireEmptyPotCap?: boolean
  denyClaimedLive?: boolean
  forcesMnemonicQuiz?: boolean
  receiveWithoutWallet?: boolean
  humanRunsNpxOnLaptop?: boolean
  helpMixesJobs?: boolean
  sparkInHumanCli?: boolean
  envDefaultMismatch?: boolean
  usageLiesAboutBrowser?: boolean
}

export interface JudgeExpect {
  copy?: CopyExpect
  skill?: JudgeSkillId
  route?: JudgeHandlerId
}

/**
 * Starting thresholds for this eval — not cookbook defaults.
 * Re-evaluate on our fixtures before tightening.
 */
export const NOUL_FAIL = 0.7
export const NOUL_REVIEW = 0.4
export const CHOICE_CONFIDENCE_ACT = 0.5

function harmNoul(
  name: string,
  noul: number,
  expectBad: boolean | undefined,
): { verdict: JudgeVerdict; reason: string } | null {
  if (expectBad === undefined) return null
  if (expectBad) {
    if (noul >= NOUL_FAIL) {
      return { verdict: 'pass', reason: `${name}=${noul.toFixed(2)} (expected harm present)` }
    }
    if (noul >= NOUL_REVIEW) {
      return { verdict: 'review', reason: `${name}=${noul.toFixed(2)} (expected harm, uncertain)` }
    }
    return { verdict: 'fail', reason: `${name}=${noul.toFixed(2)} (expected harm missing)` }
  }
  if (noul >= NOUL_FAIL) {
    return { verdict: 'fail', reason: `${name}=${noul.toFixed(2)} (unexpected harm)` }
  }
  if (noul >= NOUL_REVIEW) {
    return { verdict: 'review', reason: `${name}=${noul.toFixed(2)} (uncertain harm)` }
  }
  return { verdict: 'pass', reason: `${name}=${noul.toFixed(2)} (no harm)` }
}

function worse(a: JudgeVerdict, b: JudgeVerdict): JudgeVerdict {
  if (a === 'fail' || b === 'fail') return 'fail'
  if (a === 'review' || b === 'review') return 'review'
  return 'pass'
}

export function decideCopyHonesty(
  answers: HybridEvalAnswers,
  spendMode: JudgeSpendMode,
  expect: CopyExpect = {},
): JudgeDecision {
  const checks = [
    harmNoul(
      'claims_disconnect_stops_spend',
      answers.claims_disconnect_stops_spend.noul,
      expect.disconnectLie ?? false,
    ),
    harmNoul(
      'treats_install_as_runtime_pot',
      answers.treats_install_as_runtime_pot.noul,
      expect.installAsPot ?? false,
    ),
    harmNoul(
      'exposes_pot_secret',
      answers.exposes_pot_secret.noul,
      expect.secretLeak ?? false,
    ),
    harmNoul(
      'claims_attach_deny_is_live',
      answers.claims_attach_deny_is_live.noul,
      expect.denyClaimedLive,
    ),
    harmNoul(
      'forces_mnemonic_quiz',
      answers.forces_mnemonic_quiz.noul,
      expect.forcesMnemonicQuiz,
    ),
    harmNoul(
      'allows_receive_without_wallet',
      answers.allows_receive_without_wallet.noul,
      expect.receiveWithoutWallet,
    ),
    harmNoul(
      'human_runs_npx_on_laptop',
      answers.human_runs_npx_on_laptop.noul,
      expect.humanRunsNpxOnLaptop,
    ),
    harmNoul(
      'help_mixes_jobs',
      answers.help_mixes_jobs.noul,
      expect.helpMixesJobs,
    ),
    harmNoul(
      'spark_in_human_cli',
      answers.spark_in_human_cli.noul,
      expect.sparkInHumanCli,
    ),
    harmNoul(
      'env_default_mismatch',
      answers.env_default_mismatch.noul,
      expect.envDefaultMismatch,
    ),
    harmNoul(
      'usage_lies_about_browser',
      answers.usage_lies_about_browser.noul,
      expect.usageLiesAboutBrowser,
    ),
  ]
  const applied = checks.filter(
    (check): check is NonNullable<(typeof checks)[number]> => check != null,
  )
  const reasons = applied.map((check) => check.reason)
  let verdict = applied.reduce<JudgeVerdict>(
    (current, check) => worse(current, check.verdict),
    'pass',
  )

  if (expect.requireEmptyPotCap && spendMode === 'free') {
    const cap = answers.states_empty_pot_is_cap.noul
    if (cap >= NOUL_FAIL) {
      reasons.push(`states_empty_pot_is_cap=${cap.toFixed(2)} (cap stated)`)
    } else if (cap >= NOUL_REVIEW) {
      verdict = worse(verdict, 'review')
      reasons.push(`states_empty_pot_is_cap=${cap.toFixed(2)} (cap uncertain)`)
    } else {
      verdict = worse(verdict, 'fail')
      reasons.push(`states_empty_pot_is_cap=${cap.toFixed(2)} (free propose missing cap)`)
    }
  }

  return { verdict, reasons }
}

export function decideSkill(
  answers: HybridEvalAnswers,
  expected: JudgeSkillId,
): JudgeDecision {
  const chosen = answers.chosen_skill.choice
  const confidence = answers.chosen_skill.confidence
  const needsBuyer = answers.needs_buyer_skill.noul
  const reasons = [
    `chosen_skill=${chosen} confidence=${confidence.toFixed(2)}`,
    `needs_buyer_skill=${needsBuyer.toFixed(2)}`,
  ]

  if (confidence < CHOICE_CONFIDENCE_ACT) {
    if (expected === 'none' && chosen !== 'zappi_agent_pot' && needsBuyer < NOUL_REVIEW) {
      return { verdict: 'pass', reasons }
    }
    return { verdict: 'review', reasons: [...reasons, 'choice confidence below act threshold'] }
  }

  if (chosen !== expected) {
    return { verdict: 'fail', reasons: [...reasons, `expected ${expected}`] }
  }

  if (expected === 'zappi_agent_pot' && needsBuyer < NOUL_REVIEW) {
    return { verdict: 'review', reasons: [...reasons, 'buyer skill chosen but needs_buyer_skill is low'] }
  }

  if (expected === 'none' && needsBuyer >= NOUL_FAIL) {
    return { verdict: 'fail', reasons: [...reasons, 'none expected but needs_buyer_skill is high'] }
  }

  return { verdict: 'pass', reasons }
}

export function decideRoute(
  answers: HybridEvalAnswers,
  expected: JudgeHandlerId,
): JudgeDecision {
  const chosen = answers.handler.choice
  const confidence = answers.handler.confidence
  const reasons = [`handler=${chosen} confidence=${confidence.toFixed(2)}`]

  if (confidence < CHOICE_CONFIDENCE_ACT) {
    return { verdict: 'review', reasons: [...reasons, 'choice confidence below act threshold'] }
  }

  if (chosen !== expected) {
    return { verdict: 'fail', reasons: [...reasons, `expected ${expected}`] }
  }

  return { verdict: 'pass', reasons }
}

export function decideHybridEval(
  focus: JudgeFocus,
  answers: HybridEvalAnswers,
  spendMode: JudgeSpendMode,
  expect: JudgeExpect,
): JudgeDecision {
  if (focus === 'copy') return decideCopyHonesty(answers, spendMode, expect.copy)
  if (focus === 'skill') {
    if (!expect.skill) {
      return { verdict: 'fail', reasons: ['skill focus missing expect.skill'] }
    }
    return decideSkill(answers, expect.skill)
  }
  if (!expect.route) {
    return { verdict: 'fail', reasons: ['route focus missing expect.route'] }
  }
  return decideRoute(answers, expect.route)
}
