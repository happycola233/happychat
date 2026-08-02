import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelTagBadge, ModelTagList } from './ModelTags'

describe('ModelTags', () => {
  it('uses the stable automatic palette when no custom color is set', () => {
    const html = renderToStaticMarkup(<ModelTagBadge tag={{ label: '内测', color: null }} />)

    expect(html).toContain('内测')
    expect(html).not.toContain('--hc-model-tag-color')
    expect(html).not.toContain('hc-model-tag-custom')
  })

  it('passes a validated custom color through the shared badge renderer', () => {
    const html = renderToStaticMarkup(<ModelTagList tags={[{ label: '推荐', color: '#8b5cf6' }]} />)

    expect(html).toContain('hc-model-tag-custom')
    expect(html).toContain('--hc-model-tag-color:#8b5cf6')
    expect(html).toContain('推荐')
  })
})
