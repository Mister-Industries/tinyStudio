import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AGENT_MODELS,
  DEFAULT_AGENT_MODEL,
  isAgentModel,
  resolveAgentModel,
  thinkingOptionsFor
} from '../agentModels'

test('the default is in the offered list', () => {
  assert.ok(isAgentModel(DEFAULT_AGENT_MODEL))
  assert.equal(DEFAULT_AGENT_MODEL, 'claude-opus-5')
})

test('a stored choice that is missing or unknown falls back to the default', () => {
  assert.equal(resolveAgentModel(null), DEFAULT_AGENT_MODEL)
  assert.equal(resolveAgentModel(undefined), DEFAULT_AGENT_MODEL)
  assert.equal(resolveAgentModel('claude-opus-4-8'), DEFAULT_AGENT_MODEL)
  assert.equal(resolveAgentModel('claude-sonnet-5'), 'claude-sonnet-5')
})

test('Opus 5 and Sonnet 5 get adaptive thinking with an effort level', () => {
  for (const id of ['claude-opus-5', 'claude-sonnet-5'] as const) {
    assert.deepEqual(thinkingOptionsFor(id, 16000), {
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' }
    })
  }
})

test('Haiku 4.5 gets a fixed thinking budget below max_tokens and no effort', () => {
  const opts = thinkingOptionsFor('claude-haiku-4-5-20251001', 16000)
  assert.equal(opts.thinking.type, 'enabled')
  const budget = opts.thinking.type === 'enabled' ? opts.thinking.budget_tokens : 0
  assert.ok(budget >= 1024 && budget < 16000)
  assert.equal(opts.output_config, undefined)
  // A small max_tokens still leaves room for the answer.
  const small = thinkingOptionsFor('claude-haiku-4-5-20251001', 4000)
  assert.ok(small.thinking.type === 'enabled' && small.thinking.budget_tokens < 4000)
})

test('every offered model has a label and note for the picker', () => {
  for (const m of AGENT_MODELS) {
    assert.ok(m.label.length > 0)
    assert.ok(m.note.length > 0)
  }
})
