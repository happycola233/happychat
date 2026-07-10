import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MessageUsageStats } from './MessageMeta'

describe('MessageUsageStats', () => {
  it('keeps input and cache write/read token text in one continuous label', () => {
    const html = renderToStaticMarkup(
      <MessageUsageStats
        durationMs={27_000}
        usage={{
          inputTokens: 3_200,
          cacheWriteTokens: 500,
          cachedTokens: 2_700,
          outputTokens: 705,
          reasoningTokens: 0,
          totalTokens: 3_905,
        }}
      />,
    )

    expect(html).toContain('3.2K tokens（缓存写入 500 · 读取 2.7K）')
  })

  it('renders old shared-chat usage snapshots without cache-write data', () => {
    const usage = {
      inputTokens: 3_200,
      cachedTokens: 2_700,
      outputTokens: 705,
      reasoningTokens: 0,
      totalTokens: 3_905,
    } as Parameters<typeof MessageUsageStats>[0]['usage']

    const html = renderToStaticMarkup(<MessageUsageStats durationMs={null} usage={usage} />)

    expect(html).toContain('3.2K tokens（缓存读取 2.7K）')
  })
})
