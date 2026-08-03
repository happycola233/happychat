import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildLobeIconCatalog } from '../hooks/useModels'
import { ModelIconMark } from './ModelIcon'

function renderIcon(slug: string, mono: boolean): string {
  const queryClient = new QueryClient()
  queryClient.setQueryData(
    ['lobe-icons'],
    buildLobeIconCatalog({ version: '1.94.0', icons: [{ slug, mono }] }),
  )
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ModelIconMark icon={{ type: 'lobe', slug }} />
    </QueryClientProvider>,
  )
}

describe('ModelIconMark', () => {
  it('renders mixed-color icons with versioned light and dark assets', () => {
    const html = renderIcon('yi-color', false)

    expect(html).toContain('v=1.94.0')
    expect(html).toContain('theme=light')
    expect(html).toContain('theme=dark')
    expect(html).toContain('dark:hidden')
    expect(html).toContain('dark:block')
  })

  it('keeps monochrome icons on the versioned mask path', () => {
    const html = renderIcon('openai', true)

    expect(html).toContain('hc-icon-mask')
    expect(html).toContain('v=1.94.0')
    expect(html).not.toContain('theme=light')
    expect(html).not.toContain('theme=dark')
  })

  it('keeps the pre-catalog fallback URL valid', () => {
    const queryClient = new QueryClient()
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ModelIconMark icon={{ type: 'lobe', slug: 'openai' }} />
      </QueryClientProvider>,
    )

    expect(html).toContain('/api/model-icons/lobe/openai')
  })
})
