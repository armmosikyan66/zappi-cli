import { TypeSafeClient } from '@typesafe-ai/sdk'
import {
  prepareJudgeState,
  type JudgeFocus,
  type JudgeSpendMode,
  type JudgeState,
  type PrepareJudgeStateInput,
  type EvalLane,
  type HumanUiTrace,
} from './judge-state.js'
import {
  decideHybridEval,
  type HybridEvalAnswers,
  type JudgeDecision,
  type JudgeExpect,
} from './typesafe-policy.js'
import { hybridEvalQuestions } from './typesafe-questions.js'

export interface TypeSafeJudgeEnv {
  TYPESAFE_API_KEY?: string
  TYPESAFE_JUDGE?: string
}

/** Live TypeSafe is opt-in. Default `npm test` never sets this. */
export function isTypeSafeJudgeEnabled(
  env: TypeSafeJudgeEnv = process.env,
): boolean {
  return Boolean(env.TYPESAFE_API_KEY?.trim()) && env.TYPESAFE_JUDGE === '1'
}

export function createEvalClient(options: {
  apiKey?: string
  fetch?: typeof fetch
  env?: TypeSafeJudgeEnv
} = {}): TypeSafeClient {
  const apiKey =
    options.apiKey?.trim() ||
    options.env?.TYPESAFE_API_KEY?.trim() ||
    process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'TYPESAFE_API_KEY is required for the TypeSafe judge. Money-path `npm test` does not need it.',
    )
  }
  return new TypeSafeClient({
    apiKey,
    fetch: options.fetch,
  })
}

export interface HybridEvalJudgeResult {
  state: JudgeState
  answers: HybridEvalAnswers
  decision: JudgeDecision
  model: string
}

export async function runHybridEvalJudge(input: {
  transcript: string
  userTurn?: string
  spendMode?: JudgeSpendMode
  lane?: EvalLane
  ui?: HumanUiTrace
  focus: JudgeFocus
  expect: JudgeExpect
  client: TypeSafeClient
}): Promise<HybridEvalJudgeResult> {
  const state = prepareJudgeState({
    transcript: input.transcript,
    userTurn: input.userTurn,
    spendMode: input.spendMode,
    lane: input.lane,
    ui: input.ui,
  } satisfies PrepareJudgeStateInput)
  const questions = hybridEvalQuestions()
  const response = await input.client.systemOne({
    state: {
      transcript: state.transcript,
      userTurn: state.userTurn,
      lane: state.lane,
      ui: state.ui
        ? {
            url: state.ui.url,
            panel: state.ui.panel,
            action: state.ui.action,
          }
        : null,
      policy: { ...state.policy },
    },
    questions,
  })
  const answers = response.answers
  return {
    state,
    answers,
    model: response.model,
    decision: decideHybridEval(input.focus, answers, state.policy.spendMode, input.expect),
  }
}
