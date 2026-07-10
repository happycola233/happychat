import { describe, expect, it } from 'vitest'
import { resolveReasoningEffortIconKey } from './reasoningEffortIcon'

describe('resolveReasoningEffortIconKey', () => {
  it.each(['none', 'low', 'medium', 'high', 'xhigh'] as const)(
    'keeps the original %s icon',
    (effort) => {
      expect(resolveReasoningEffortIconKey(effort)).toBe(effort)
    },
  )

  it('maps max to the original xhigh icon', () => {
    expect(resolveReasoningEffortIconKey('max')).toBe('xhigh')
  })

  it.each(['vendor-ultra', '__proto__', 'constructor', null, undefined])(
    'falls back from %s to the high icon',
    (effort) => {
      expect(resolveReasoningEffortIconKey(effort)).toBe('high')
    },
  )
})
