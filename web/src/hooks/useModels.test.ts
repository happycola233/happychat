import { describe, expect, it } from 'vitest'
import { buildLobeIconCatalog } from './useModels'

describe('buildLobeIconCatalog', () => {
  it('keeps version and builds one reusable slug index', () => {
    const catalog = buildLobeIconCatalog({
      version: '1.94.0',
      icons: [
        { slug: 'openai', mono: true },
        { slug: 'yi-color', mono: false },
      ],
    })

    expect(catalog.version).toBe('1.94.0')
    expect(catalog.monoBySlug.openai).toBe(true)
    expect(catalog.monoBySlug['yi-color']).toBe(false)
    expect(catalog.monoBySlug.missing).toBeUndefined()
    expect(catalog.slugs).toEqual(['openai', 'yi-color'])
    expect(catalog.monoBySlug).toEqual({ openai: true, 'yi-color': false })
  })
})
