import { describe, expect, it } from 'vitest'
import { commentaryTextsOf, processStepsOf, reasoningTextOf, searchActionsOf } from './processTrack'

describe('process track compatibility', () => {
  it('adapts a legacy row into the same reasoning-then-search presentation order', () => {
    const legacy = {
      processSteps: null,
      reasoningSummary: '**分析**\n\n旧摘要',
      searchActions: [
        { type: 'search' as const, queries: ['phase'] },
        { type: 'open_page' as const, url: 'https://example.com' },
      ],
    }

    expect(processStepsOf(legacy)).toEqual([
      { kind: 'reasoning', text: '**分析**\n\n旧摘要' },
      { kind: 'search', action: { type: 'search', queries: ['phase'] } },
      { kind: 'search', action: { type: 'open_page', url: 'https://example.com' } },
    ])
    expect(reasoningTextOf(legacy)).toBe('**分析**\n\n旧摘要')
    expect(searchActionsOf(legacy)).toHaveLength(2)
    expect(commentaryTextsOf(legacy)).toEqual([])
  })

  it('treats an explicitly empty processSteps array as authoritative', () => {
    expect(
      processStepsOf({
        processSteps: [],
        reasoningSummary: '不应回退',
        searchActions: [{ type: 'search', queries: ['不应回退'] }],
      }),
    ).toEqual([])
  })
})
