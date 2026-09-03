import { describe, expect, it } from 'vitest'
import { resolveActiveReasoningEffort, toggleReasoningEffortSelection } from './chat'

describe('toggleReasoningEffortSelection', () => {
  it('再次选择当前档位时回到自动', () => {
    expect(toggleReasoningEffortSelection('high', 'high')).toBeNull()
  })

  it('选择新档位时替换当前档位', () => {
    expect(toggleReasoningEffortSelection(null, 'low')).toBe('low')
    expect(toggleReasoningEffortSelection('low', 'high')).toBe('high')
  })
})

describe('resolveActiveReasoningEffort', () => {
  it('新会话沿用用户固定的默认档位', () => {
    expect(resolveActiveReasoningEffort(undefined, 'high')).toBe('high')
  })

  it('已有会话明确记录为自动时不回退到固定档位', () => {
    expect(resolveActiveReasoningEffort(null, 'high')).toBeNull()
  })
})
