import { describe, expect, it } from 'vitest'
import { buildInput } from './context'

describe('buildInput', () => {
  it('emits a virtual system runtime context immediately before its user message', () => {
    const input = buildInput([
      {
        role: 'user',
        runtimeContext: '<runtime_context>first</runtime_context>',
        content: [{ type: 'input_text', text: 'hello' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hi' }],
      },
      {
        role: 'user',
        runtimeContext: '<runtime_context>second</runtime_context>',
        content: [{ type: 'input_text', text: 'again' }],
      },
    ])

    expect(input).toEqual([
      {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: '<runtime_context>first</runtime_context>' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'hi', annotations: [] }],
      },
      {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: '<runtime_context>second</runtime_context>' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'again' }],
      },
    ])
  })

  it('does not invent runtime context for legacy messages', () => {
    expect(
      buildInput([{ role: 'user', content: [{ type: 'input_text', text: 'legacy' }] }]),
    ).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'legacy' }],
      },
    ])
  })
})
