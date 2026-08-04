import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_FOLDER_COLOR } from '@shared/constants'
import { buildLobeIconCatalog } from '../hooks/useModels'
import { ModelGroupGlyph, ModelIconMark } from './ModelIcon'

function renderWithCatalog(
  node: ReactNode,
  icons: Array<{ slug: string; mono: boolean }> = [],
): string {
  const queryClient = new QueryClient()
  queryClient.setQueryData(['lobe-icons'], buildLobeIconCatalog({ version: '1.94.0', icons }))
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  )
}

function renderIcon(slug: string, mono: boolean): string {
  return renderWithCatalog(<ModelIconMark icon={{ type: 'lobe', slug }} />, [{ slug, mono }])
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

  it('lets an explicit initial override a successful automatic brand match', () => {
    const automatic = renderWithCatalog(
      <ModelIconMark icon={null} modelId="gpt-5.6" displayName="GPT 5.6" />,
      [{ slug: 'openai', mono: true }],
    )
    const forcedInitial = renderWithCatalog(
      <ModelIconMark icon={{ type: 'initial' }} modelId="gpt-5.6" displayName="GPT 5.6" />,
      [{ slug: 'openai', mono: true }],
    )

    expect(automatic).toContain('/api/model-icons/lobe/openai')
    expect(forcedInitial).toContain('>G</span>')
    expect(forcedInitial).not.toContain('/api/model-icons/lobe/openai')
  })

  it('optically enlarges the initial tile without widening the shared icon slot', () => {
    const html = renderWithCatalog(
      <ModelIconMark
        icon={{ type: 'initial' }}
        modelId="gpt-5.6-terra"
        displayName="GPT-5.6-Terra"
        size="md"
      />,
    )
    const rootTag = html.match(/^<span\b[^>]*>/)?.[0] ?? ''

    expect(rootTag).toContain('h-5 w-5')
    expect(html).toContain('h-6 w-6')
    expect(html).toContain('text-sm')
    expect(html).toContain('bg-neutral-200')
  })

  it('does not invent a dot placeholder for an empty model draft', () => {
    const html = renderWithCatalog(<ModelIconMark icon={null} modelId="" displayName="" />)

    expect(html).toBe('')
    expect(html).not.toContain('·')
  })
})

describe('ModelGroupGlyph', () => {
  it('renders no node or transparent placeholder for the explicit none mode', () => {
    const html = renderWithCatalog(
      <ModelGroupGlyph group={{ icon: { type: 'none' }, color: '#8b5cf6' }} size="md" />,
    )

    expect(html).toBe('')
  })

  it('normalizes default and Emoji group icons to the same unpadded size', () => {
    const defaultGroup = renderWithCatalog(
      <ModelGroupGlyph group={{ icon: null, color: null }} size="md" />,
    )
    const coloredDefaultGroup = renderWithCatalog(
      <ModelGroupGlyph group={{ icon: null, color: '#8b5cf6' }} size="md" />,
    )
    const emojiGroup = renderWithCatalog(
      <ModelGroupGlyph
        group={{ icon: { type: 'emoji', char: '🧠' }, color: '#8b5cf6' }}
        size="md"
      />,
    )

    const defaultRootTag = defaultGroup.match(/^<span\b[^>]*>/)?.[0] ?? ''
    const emojiRootTag = emojiGroup.match(/^<span\b[^>]*>/)?.[0] ?? ''
    expect(defaultGroup).toContain('lucide-folder')
    expect(defaultGroup).toContain('h-full w-full')
    expect(defaultRootTag).toContain('h-5 w-5')
    expect(emojiGroup).toContain('🧠')
    expect(emojiRootTag).toContain('h-5 w-5')
    expect(emojiGroup).toContain('text-[18px]')
    expect(coloredDefaultGroup).toContain('style="color:#8b5cf6"')
    expect(emojiGroup).not.toContain('#8b5cf6')
    expect(defaultGroup).toContain(`style="color:${DEFAULT_FOLDER_COLOR}"`)
    expect(defaultGroup).not.toContain('text-neutral-700')
    expect(emojiGroup).toContain('text-neutral-700')
    for (const html of [defaultGroup, coloredDefaultGroup, emojiGroup]) {
      const rootTag = html.match(/^<span\b[^>]*>/)?.[0] ?? ''
      expect(html).not.toContain('hc-icon-chip')
      expect(html).not.toContain('hc-contrasted-glyph')
      expect(html).not.toContain('bg-neutral-200/70')
      expect(html).not.toContain('dark:bg-neutral-700/60')
      expect(rootTag).not.toMatch(/\b(?:(?:dark:)?bg-|rounded|border|shadow|ring)/)
      expect(rootTag).not.toMatch(/\b(?:[mp](?:[trblxy])?-|gap-)/)
    }
  })
})
