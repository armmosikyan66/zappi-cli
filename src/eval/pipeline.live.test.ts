import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PIPELINE_FIXTURES } from './pipeline-fixtures.js'
import { runPass3, runPipeline } from './pipeline.js'
import { createEvalClient, isTypeSafeJudgeEnabled } from './typesafe-judge.js'

const live = isTypeSafeJudgeEnabled()

describe('eval pipeline live (agent-agent + human-ui)', { skip: !live }, () => {
  it('grades both lanes in one TypeSafe pass', async () => {
    const client = createEvalClient()
    const report = await runPipeline(client)
    const agent = report.trials.filter((trial) => trial.lane === 'agent-agent')
    const human = report.trials.filter((trial) => trial.lane === 'human-ui')
    assert.ok(agent.length > 0, 'agent-agent lane empty')
    assert.ok(human.length > 0, 'human-ui lane empty')
    assert.equal(
      report.failed.length,
      0,
      report.failed
        .map((row) => `${row.fixtureId}#${row.trial} ${row.verdict}: ${row.reasons.join('; ')}`)
        .join('\n'),
    )
    assert.ok(report.blocked.some((row) => row.blockedBy === '1-203'))
  })

  it('Pass^3 on copy paraphrases (all three trials pass)', async () => {
    const client = createEvalClient()
    const copy = PIPELINE_FIXTURES.filter((fixture) => fixture.pass3)
    assert.ok(copy.length >= 4)
    const failures: string[] = []
    for (const fixture of copy) {
      const trials = await runPass3(fixture, client)
      const missed = trials.filter((trial) => trial.verdict !== 'pass')
      if (missed.length > 0) {
        failures.push(
          `${fixture.id}: ${missed.map((trial) => `#${trial.trial} ${trial.verdict} ${trial.reasons.join('; ')}`).join(' | ')}`,
        )
      }
    }
    assert.equal(failures.length, 0, failures.join('\n'))
  })
})
