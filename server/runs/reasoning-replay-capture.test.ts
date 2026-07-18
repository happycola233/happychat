import { describe, expect, it, vi } from 'vitest'
import type { ModelParams } from '@shared/types/domain'
import type { UpstreamResponse } from '../provider/upstream-types'
import { buildReasoningReplayContext } from './reasoning-replay-capture'

const provider = { id: 'provider-1', baseUrl: 'https://example.test/v1' }
const model = {
  kind: 'responses' as const,
  modelId: 'gpt-test',
  replayReasoning: true,
  capabilities: { reasoning: true },
  allowedEfforts: ['none', 'medium'],
  defaultParams: null,
  defaultEffort: 'medium',
}
const reasoningItem = {
  id: 'rs_1',
  type: 'reasoning',
  content: [],
  encrypted_content: 'opaque-cipher',
  summary: [{ type: 'summary_text', text: '摘要' }],
}
const response: UpstreamResponse = {
  output: [reasoningItem, { id: 'msg_1', type: 'message', content: [] }],
  reasoning: { context: 'all_turns' },
}

function capture(overrides: Partial<Parameters<typeof buildReasoningReplayContext>[0]> = {}) {
  return buildReasoningReplayContext({
    runId: 'run-1',
    terminalState: 'completed',
    model,
    provider,
    response,
    ...overrides,
  })
}

describe('reasoning replay capture', () => {
  it('keeps terminal reasoning items verbatim with the source snapshot and echoed context', () => {
    const context = capture()

    expect(context).toEqual({
      version: 1,
      source: {
        providerId: 'provider-1',
        providerBaseUrl: 'https://example.test/v1',
        upstreamModelId: 'gpt-test',
      },
      reasoningContext: 'all_turns',
      items: [reasoningItem],
    })
    expect(context?.items[0]).toBe(reasoningItem)
  })

  it.each([
    ['switch off', { model: { ...model, replayReasoning: false } }],
    ['effort none', { requestParams: { reasoning_effort: 'none' } satisfies ModelParams }],
    ['chat protocol', { model: { ...model, kind: 'chat' as const } }],
    ['failed response', { terminalState: 'failed' as const }],
    ['canceled response', { terminalState: 'canceled' as const }],
  ])('does not capture for %s', (_label, overrides) => {
    expect(capture(overrides)).toBeNull()
  })

  it('captures a completed part from an incomplete terminal response', () => {
    expect(capture({ terminalState: 'incomplete' })?.items).toEqual([reasoningItem])
  })

  it('drops the whole context above 256KB and warns with the run id', () => {
    const warn = vi.fn()
    const oversizedResponse: UpstreamResponse = {
      output: [{ type: 'reasoning', encrypted_content: 'x'.repeat(256 * 1024) }],
    }

    expect(capture({ response: oversizedResponse, warn })).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('run run-1'))
  })
})
