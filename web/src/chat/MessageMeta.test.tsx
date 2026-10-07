import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MessageUsageStats } from './MessageMeta'

const textContent = (html: string) => html.replace(/<[^>]+>/g, '')

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

    expect(textContent(html)).toContain('3.2K tokens（缓存写入 500 · 读取 2.7K）')
    expect(textContent(html)).toContain('705 tokens')
    expect(html.match(/data-token-unit="true"/g)).toHaveLength(2)
    expect(html).toContain('title="输入 Token 数"')
    expect(html).toContain('title="输出 Token 数"')
    expect(html).toContain('title="生成速度（Token/s）"')
    expect(html).toContain('title="本次请求耗时"')
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

    expect(textContent(html)).toContain('3.2K tokens（缓存读取 2.7K）')
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

  it('shows converted CNY while keeping the original USD cost in the tooltip', () => {
    const html = renderToStaticMarkup(
      <MessageUsageStats
        durationMs={1_000}
        usage={{
          inputTokens: 10,
          cacheWriteTokens: 0,
          cachedTokens: 0,
          outputTokens: 5,
          reasoningTokens: 0,
          totalTokens: 15,
        }}
        costUsd={0.0681}
        costDisplay={{ currency: 'CNY', usdToCnyRate: 7.123456 }}
      />,
    )

    expect(html).toContain('¥0.4851')
    expect(html).toContain('原始成本：$0.0681 USD')
    expect(html).toContain('汇率：1 USD ≈ 7.123456 CNY')
  })

  it('shows unpriced images as free without configuration notices for users', () => {
    const html = renderToStaticMarkup(
      <MessageUsageStats
        usage={{
          inputTokens: 0,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        }}
        durationMs={null}
        costUsd={0}
        costDisplay={{ currency: 'CNY', usdToCnyRate: 7 }}
        costBreakdown={{
          chatUsd: 0,
          imageUsd: 0,
          totalUsd: 0,
          imageCount: 1,
          imageStatus: 'missing_pricing',
        }}
      />,
    )

    expect(html).toContain('¥0')
    expect(html).toContain('图片生成')
    expect(html).not.toContain('未完整统计')
    expect(html).not.toContain('未配置')
    expect(html).not.toContain('已统计')
  })

  it('uses the displayed currency for both chat and image amounts', () => {
    const html = renderToStaticMarkup(
      <MessageUsageStats
        usage={{
          inputTokens: 1000,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 500,
          reasoningTokens: 0,
          totalTokens: 1500,
        }}
        durationMs={1000}
        costUsd={0.15}
        costDisplay={{ currency: 'CNY', usdToCnyRate: 7 }}
        costBreakdown={{
          chatUsd: 0.03,
          imageUsd: 0.12,
          totalUsd: 0.15,
          imageCount: 1,
          imageStatus: 'complete',
        }}
      />,
    )
    expect(html).toContain('¥0.21')
    expect(html).toContain('¥0.84')
    expect(html).toContain('¥1.05')
  })
})
