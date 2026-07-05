import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MessageUsageStats } from './MessageMeta'

describe('MessageUsageStats', () => {
  it('keeps input and cached token text in one continuous label', () => {
    const html = renderToStaticMarkup(
      <MessageUsageStats
        durationMs={27_000}
        usage={{
          inputTokens: 3_200,
          cachedTokens: 2_700,
          outputTokens: 705,
          reasoningTokens: 0,
          totalTokens: 3_905,
        }}
      />,
    )

    expect(html).toContain('3.2K tokens（2.7K cached）')
  })
})
