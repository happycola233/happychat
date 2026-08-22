import { describe, expect, it } from 'vitest'
import { searchIconSlugs } from './iconSearch'

const CATALOG = ['openai', 'doubao-color', 'qwen-color', 'kimi', 'zhipu-color'] as const

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
    expect(searchIconSlugs(CATALOG, 'tongyi', 120).slugs).toEqual(['qwen-color'])
    expect(searchIconSlugs(CATALOG, 'tyqw', 120).slugs).toEqual(['qwen-color'])
    expect(searchIconSlugs(CATALOG, '月之暗面', 120).slugs).toEqual(['kimi'])
  })

  it('automatically derives pinyin from maintained Chinese brand names', () => {
    expect(searchIconSlugs(['minimax-color'], 'hailuo', 120).slugs).toEqual(['minimax-color'])
    expect(searchIconSlugs(['kimi'], 'yuezhianmian', 120).slugs).toEqual(['kimi'])
  })

  it('reports the full match count before applying the rendering limit', () => {
    const result = searchIconSlugs(['foo', 'foo-color', 'my-foo'], 'foo', 2)
    expect(result.slugs).toEqual(['foo', 'foo-color'])
    expect(result.total).toBe(3)
  })
})
