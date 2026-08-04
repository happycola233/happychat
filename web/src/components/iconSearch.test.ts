import { describe, expect, it } from 'vitest'
import { buildIconSearchForms, searchIconSlugs } from './iconSearch'

const CATALOG = ['openai', 'doubao-color', 'qwen-color', 'kimi', 'zhipu-color'] as const

describe('buildIconSearchForms', () => {
  it('normalizes Chinese spacing without requiring a runtime transliteration dictionary', () => {
    expect(buildIconSearchForms(' 豆 包 ')).toEqual(['豆包'])
  })

  it('normalizes latin spacing and separators', () => {
    expect(buildIconSearchForms('Dou Bao')).toEqual(['doubao'])
    expect(buildIconSearchForms('CLAUDE-COLOR')).toEqual(['claudecolor'])
  })
})

describe('searchIconSlugs', () => {
  it('maps ChatGPT to OpenAI without case sensitivity', () => {
    expect(searchIconSlugs(CATALOG, 'chatgpt', 120).slugs).toEqual(['openai'])
    expect(searchIconSlugs(CATALOG, 'ChatGPT', 120).slugs).toEqual(['openai'])
    expect(searchIconSlugs(CATALOG, 'CHAT GPT', 120).slugs).toEqual(['openai'])
  })

  it('finds every brand variant from a curated Chinese alias', () => {
    expect(searchIconSlugs(CATALOG, '豆包', 120)).toEqual({
      slugs: ['doubao-color'],
      total: 1,
    })

    expect(searchIconSlugs(['doubao', 'doubao-color', 'doubao-text'], '豆包', 120)).toEqual({
      slugs: ['doubao', 'doubao-color', 'doubao-text'],
      total: 3,
    })
  })

  it('uses maintained aliases when a Chinese brand name is not the slug transliteration', () => {
    expect(searchIconSlugs(CATALOG, '千问', 120).slugs).toEqual(['qwen-color'])
    expect(searchIconSlugs(CATALOG, 'qianwen', 120).slugs).toEqual(['qwen-color'])
    expect(searchIconSlugs(CATALOG, '月之暗面', 120).slugs).toEqual(['kimi'])
  })

  it('reports the full match count before applying the rendering limit', () => {
    const result = searchIconSlugs(['foo', 'foo-color', 'my-foo'], 'foo', 2)
    expect(result.slugs).toEqual(['foo', 'foo-color'])
    expect(result.total).toBe(3)
  })
})
