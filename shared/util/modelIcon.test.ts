import { describe, expect, it } from 'vitest'
import { normalizeModelIcon, normalizeModelIconAsset, sameModelIcon } from './modelIcon'

describe('normalizeModelIcon', () => {
  it('accepts the three asset shapes and the explicit initial mode', () => {
    expect(normalizeModelIcon({ type: 'lobe', slug: 'anthropic' })).toEqual({
      type: 'lobe',
      slug: 'anthropic',
    })
    expect(
      normalizeModelIcon({ type: 'custom', id: '0199a0f1-2b3c-7def-8123-456789abcdef' }),
    ).toEqual({ type: 'custom', id: '0199a0f1-2b3c-7def-8123-456789abcdef' })
    expect(normalizeModelIcon({ type: 'emoji', char: '🚀' })).toEqual({ type: 'emoji', char: '🚀' })
    expect(normalizeModelIcon({ type: 'initial' })).toEqual({ type: 'initial' })
    expect(normalizeModelIconAsset({ type: 'initial' })).toBeNull()
  })

  it('trims and lowercases lobe slugs', () => {
    expect(normalizeModelIcon({ type: 'lobe', slug: '  Claude-Color  ' })).toEqual({
      type: 'lobe',
      slug: 'claude-color',
    })
  })

  it.each([
    ['path traversal', { type: 'lobe', slug: '../../etc/passwd' }],
    ['slash', { type: 'lobe', slug: 'foo/bar' }],
    ['dot', { type: 'lobe', slug: 'foo.svg' }],
    ['css injection', { type: 'lobe', slug: 'a");background:url(evil' }],
    ['leading dash', { type: 'lobe', slug: '-openai' }],
    ['empty slug', { type: 'lobe', slug: '' }],
    ['overlong slug', { type: 'lobe', slug: 'a'.repeat(65) }],
    ['non-hex custom id', { type: 'custom', id: 'not/an/id' }],
    ['short custom id', { type: 'custom', id: 'abc' }],
    ['unknown type', { type: 'svg', url: 'https://evil.test/x.svg' }],
    ['missing type', { slug: 'openai' }],
    ['array', [{ type: 'lobe', slug: 'openai' }]],
    ['string', 'openai'],
    ['null', null],
    ['number', 42],
  ])('rejects %s by returning null', (_label, value) => {
    expect(normalizeModelIcon(value)).toBeNull()
  })

  it('accepts a single grapheme cluster emoji including ZWJ sequences and CJK', () => {
    expect(normalizeModelIcon({ type: 'emoji', char: '👩‍💻' })).toEqual({
      type: 'emoji',
      char: '👩‍💻',
    })
    expect(normalizeModelIcon({ type: 'emoji', char: '国' })).toEqual({ type: 'emoji', char: '国' })
  })

  it('rejects multi-grapheme emoji values', () => {
    expect(normalizeModelIcon({ type: 'emoji', char: '🚀🚀' })).toBeNull()
    expect(normalizeModelIcon({ type: 'emoji', char: '一段文字' })).toBeNull()
    expect(normalizeModelIcon({ type: 'emoji', char: '   ' })).toBeNull()
  })
})

describe('sameModelIcon', () => {
  it('compares by discriminant and payload', () => {
    expect(sameModelIcon(null, null)).toBe(true)
    expect(sameModelIcon(null, { type: 'lobe', slug: 'openai' })).toBe(false)
    expect(sameModelIcon({ type: 'lobe', slug: 'openai' }, { type: 'lobe', slug: 'openai' })).toBe(
      true,
    )
    expect(sameModelIcon({ type: 'lobe', slug: 'openai' }, { type: 'lobe', slug: 'grok' })).toBe(
      false,
    )
    expect(sameModelIcon({ type: 'lobe', slug: 'openai' }, { type: 'emoji', char: '🚀' })).toBe(
      false,
    )
    expect(
      sameModelIcon({ type: 'custom', id: 'aabbccdd' }, { type: 'custom', id: 'aabbccdd' }),
    ).toBe(true)
    expect(sameModelIcon({ type: 'initial' }, { type: 'initial' })).toBe(true)
    expect(sameModelIcon({ type: 'initial' }, { type: 'lobe', slug: 'openai' })).toBe(false)
  })
})
