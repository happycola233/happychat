import { describe, expect, it } from 'vitest'
import { buildRuntimeContext, resolveRuntimeTimezone } from './runtimeContext'

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
})
