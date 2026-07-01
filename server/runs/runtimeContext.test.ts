import { describe, expect, it } from 'vitest'
import {
  RUNTIME_CONTEXT_INSTRUCTIONS,
  appendRuntimeContextInstructions,
  buildRuntimeContext,
  resolveRuntimeTimezone,
} from './runtimeContext'

describe('runtime context', () => {
  it('formats an offset-aware timestamp in the validated browser timezone', () => {
    expect(buildRuntimeContext(new Date('2026-07-02T08:05:23.000Z'), 'Asia/Shanghai')).toBe(
      '<runtime_context>\ndatetime: 2026-07-02T16:05:23+08:00\ntimezone: Asia/Shanghai\n</runtime_context>',
    )
  })

  it('rejects invalid browser timezones and returns a valid fallback', () => {
    const timezone = resolveRuntimeTimezone('not/a-timezone')
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: timezone })).not.toThrow()
  })

  it('appends one stable protocol block to the current model instructions', () => {
    expect(appendRuntimeContextInstructions('Be helpful.')).toBe(
      `Be helpful.\n\n${RUNTIME_CONTEXT_INSTRUCTIONS}`,
    )
    expect(appendRuntimeContextInstructions(null)).toBe(RUNTIME_CONTEXT_INSTRUCTIONS)
  })
})
