import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BLOCKED_PIPELINE, PIPELINE_FIXTURES } from './pipeline-fixtures.js'
import { hybridEvalQuestions } from './typesafe-questions.js'

describe('eval pipeline catalog', () => {
  it('covers agent-agent and human-ui lanes without faking Nest blocks', () => {
    const lanes = new Set(PIPELINE_FIXTURES.map((fixture) => fixture.lane))
    assert.deepEqual([...lanes].sort(), ['agent-agent', 'human-ui'])
    assert.ok(PIPELINE_FIXTURES.some((fixture) => fixture.pass3))
    assert.ok(BLOCKED_PIPELINE.some((row) => row.blockedBy === '1-231'))
    assert.ok(BLOCKED_PIPELINE.some((row) => row.blockedBy === '1-203'))
    assert.equal(
      PIPELINE_FIXTURES.some((fixture) => fixture.id.includes('attach-deny-terminal')),
      false,
    )
  })

  it('asks human-ui honesty questions in the same System One map', () => {
    const questions = hybridEvalQuestions()
    assert.equal(questions.claims_attach_deny_is_live.type, 'noul')
    assert.equal(questions.forces_mnemonic_quiz.type, 'noul')
    assert.equal(questions.allows_receive_without_wallet.type, 'noul')
  })
})
