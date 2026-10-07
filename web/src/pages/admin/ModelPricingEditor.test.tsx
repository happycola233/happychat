import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelPricingEditor } from './ModelPricingEditor'
import { CostBreakdown } from '../../components/CostBreakdown'

describe('image pricing presentation', () => {
  it('pure image models show only per-image pricing without chat token prices', () => {
    const html = renderToStaticMarkup(
      <ModelPricingEditor
        kind="image"
        pricing={{ imageGeneration: { mode: 'per_image', price: 0.05 } }}
        onChange={() => {}}
        providerId="provider"
        models={[]}
      />,
    )
    expect(html).toContain('默认每张价格（USD / 张）')
    expect(html).not.toContain('聊天费用')
    expect(html).not.toContain('文字提示词输入')
  })
  it('Responses tool pricing separates chat and the three image token prices', () => {
    const html = renderToStaticMarkup(
      <ModelPricingEditor
        kind="responses"
        pricing={{ imageGeneration: { mode: 'tokens' } }}
        onChange={() => {}}
        providerId="provider"
        models={[]}
      />,
    )
    for (const label of ['聊天费用', '文字提示词输入', '参考图片输入', '图片输出', '缓存价格'])
      expect(html).toContain(label)
  })
  it('missing usage is visibly disclosed even when no image cost can be calculated', () => {
    const html = renderToStaticMarkup(
      <CostBreakdown
        breakdown={{
          chatUsd: 0,
          imageUsd: 0,
          totalUsd: 0,
          imageCount: 1,
          imageStatus: 'missing_usage',
        }}
      >
        $0
      </CostBreakdown>,
    )
    expect(html).toContain('图片费用未完整统计')
    expect(html).toContain('供应商未返回完整生图用量')
    expect(html).toContain('<summary')
  })
})
