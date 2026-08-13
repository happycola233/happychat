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

    expect(html).toContain('3.2K（缓存写入 500 · 读取 2.7K）')
    expect(html).toContain('705')
    expect(html).not.toContain('tokens')
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

    expect(html).toContain('3.2K（缓存读取 2.7K）')
  })

  it('shows a non-zero USD cost and omits zero cost', () => {
    const usage = {
      inputTokens: 10,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      outputTokens: 5,
      reasoningTokens: 0,
      totalTokens: 15,
    }

    const withCost = renderToStaticMarkup(
      <MessageUsageStats durationMs={1_000} usage={usage} costUsd={0.00006} />,
    )
    const withoutCost = renderToStaticMarkup(
      <MessageUsageStats durationMs={1_000} usage={usage} costUsd={0} />,
    )

    expect(withCost).toContain('本次预估成本（USD）')
    expect(withCost).toContain('$0.00006')
    expect(withoutCost).not.toContain('本次预估成本（USD）')
  })
})
