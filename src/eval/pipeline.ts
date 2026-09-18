import type { TypeSafeClient } from '@typesafe-ai/sdk'
import { BLOCKED_PIPELINE, PIPELINE_FIXTURES, type PipelineFixture } from './pipeline-fixtures.js'
import { runHybridEvalJudge, type HybridEvalJudgeResult } from './typesafe-judge.js'

export const PASS3_TRIALS = 3

export interface PipelineTrial {
  fixtureId: string
  lane: PipelineFixture['lane']
  trial: number
  verdict: HybridEvalJudgeResult['decision']['verdict']
  reasons: string[]
}

export interface PipelineReport {
  trials: PipelineTrial[]
  blocked: typeof BLOCKED_PIPELINE
  failed: PipelineTrial[]
}

export async function runFixtureOnce(
  fixture: PipelineFixture,
  client: TypeSafeClient,
  trial = 1,
): Promise<PipelineTrial> {
  const result = await runHybridEvalJudge({
    transcript: fixture.transcript,
    userTurn: fixture.userTurn,
    spendMode: fixture.spendMode,
    lane: fixture.lane,
    ui: fixture.ui,
    focus: fixture.focus,
    expect: fixture.expect,
    client,
  })
  return {
    fixtureId: fixture.id,
    lane: fixture.lane,
    trial,
    verdict: result.decision.verdict,
    reasons: result.decision.reasons,
  }
}

export async function runPass3(
  fixture: PipelineFixture,
  client: TypeSafeClient,
): Promise<PipelineTrial[]> {
  const trials: PipelineTrial[] = []
  for (let trial = 1; trial <= PASS3_TRIALS; trial += 1) {
    trials.push(await runFixtureOnce(fixture, client, trial))
  }
  return trials
}

export async function runPipeline(
  client: TypeSafeClient,
  options: { pass3?: boolean } = {},
): Promise<PipelineReport> {
  const trials: PipelineTrial[] = []
  for (const fixture of PIPELINE_FIXTURES) {
    if (options.pass3 && fixture.pass3) {
      trials.push(...(await runPass3(fixture, client)))
    } else {
      trials.push(await runFixtureOnce(fixture, client))
    }
  }
  return {
    trials,
    blocked: BLOCKED_PIPELINE,
    failed: trials.filter((trial) => trial.verdict !== 'pass'),
  }
}
