import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FolderGlyph } from './folderVisuals'

describe('FolderGlyph', () => {
  it('normalizes the default folder and Emoji to the same unpadded size', () => {
    const defaultFolder = renderToStaticMarkup(
      <FolderGlyph folder={{ color: null, emoji: null }} />,
    )
    const emojiFolder = renderToStaticMarkup(<FolderGlyph folder={{ color: null, emoji: '📚' }} />)

    const defaultRootTag = defaultFolder.match(/^<span\b[^>]*>/)?.[0] ?? ''
    const emojiRootTag = emojiFolder.match(/^<span\b[^>]*>/)?.[0] ?? ''
    expect(defaultFolder).toContain('lucide-folder')
    expect(defaultFolder).toContain('h-full w-full')
    expect(defaultRootTag).toContain('h-4 w-4')
    expect(emojiFolder).toContain('📚')
    expect(emojiRootTag).toContain('h-4 w-4')
    expect(emojiRootTag).toContain('text-[14px]')
    for (const html of [defaultFolder, emojiFolder]) {
      const rootTag = html.match(/^<span\b[^>]*>/)?.[0] ?? ''
      expect(html).not.toContain('bg-neutral-200/70')
      expect(html).not.toContain('dark:bg-neutral-700/60')
      expect(rootTag).not.toMatch(/\b(?:(?:dark:)?bg-|rounded|border|shadow|ring)/)
      expect(rootTag).not.toMatch(/\b(?:[mp](?:[trblxy])?-|gap-)/)
    }
  })

  it('keeps a custom foreground color without adding a background style', () => {
    const html = renderToStaticMarkup(<FolderGlyph folder={{ color: '#f97316', emoji: '📚' }} />)

    expect(html).toContain('📚')
    expect(html).toContain('hc-colored-glyph')
    expect(html).toContain('--hc-glyph-color:#f97316')
  })
})
