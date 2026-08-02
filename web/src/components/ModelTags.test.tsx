import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelTagBadge, ModelTagList } from './ModelTags'

describe('ModelTags', () => {
  it('uses the stable automatic palette when no custom color is set', () => {
    const html = renderToStaticMarkup(<ModelTagBadge tag={{ label: 'Flagship', color: null }} />)

    expect(html).toContain('Flagship')
    expect(html).toContain('bg-emerald-50')
    expect(html).not.toContain('--hc-model-tag-color')
    expect(html).not.toContain('hc-model-tag-custom')
  })

  it('renders a manually selected automatic tone exactly like automatic mode', () => {
    const automaticHtml = renderToStaticMarkup(
      <ModelTagBadge tag={{ label: 'Flagship', color: null }} />,
    )
    const selectedHtml = renderToStaticMarkup(
      <ModelTagBadge tag={{ label: 'Flagship', color: '#10b981' }} />,
    )

    expect(selectedHtml).toBe(automaticHtml)
  })

  it('passes an arbitrary validated custom color through the shared badge renderer', () => {
    const html = renderToStaticMarkup(<ModelTagList tags={[{ label: '推荐', color: '#123456' }]} />)

    expect(html).toContain('hc-model-tag-custom')
    expect(html).toContain('--hc-model-tag-color:#123456')
    expect(html).toContain('推荐')
  })
})
