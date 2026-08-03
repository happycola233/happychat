import { describe, expect, it } from 'vitest'
import {
  modelGroupAssignSchema,
  modelGroupCreateSchema,
  modelGroupReorderSchema,
  modelGroupUpdateSchema,
  modelIconBatchSchema,
  modelIconSchema,
} from './model-group'

describe('modelIconSchema', () => {
  it('accepts the three sources', () => {
    expect(modelIconSchema.parse({ type: 'lobe', slug: 'claude-color' })).toEqual({
      type: 'lobe',
      slug: 'claude-color',
    })
    expect(modelIconSchema.parse({ type: 'custom', id: '0199a0f1-2b3c-7def-8123-456789abcdef' }))
      .toEqual({ type: 'custom', id: '0199a0f1-2b3c-7def-8123-456789abcdef' })
    expect(modelIconSchema.parse({ type: 'emoji', char: '🚀' })).toEqual({
      type: 'emoji',
      char: '🚀',
    })
  })

  it('trims and lowercases slugs', () => {
    expect(modelIconSchema.parse({ type: 'lobe', slug: ' OpenAI ' })).toEqual({
      type: 'lobe',
      slug: 'openai',
    })
  })

  it.each([
    ['path traversal', { type: 'lobe', slug: '../secret' }],
    ['dot in slug', { type: 'lobe', slug: 'a.svg' }],
    ['unknown source', { type: 'url', url: 'https://evil.test/a.svg' }],
    ['multi-grapheme emoji', { type: 'emoji', char: '🚀🚀' }],
    ['blank emoji', { type: 'emoji', char: ' ' }],
    ['bad custom id', { type: 'custom', id: '../../x' }],
  ])('rejects %s', (_label, value) => {
    expect(modelIconSchema.safeParse(value).success).toBe(false)
  })

  it('accepts ZWJ emoji and a single CJK character', () => {
    expect(modelIconSchema.safeParse({ type: 'emoji', char: '👩‍💻' }).success).toBe(true)
    expect(modelIconSchema.safeParse({ type: 'emoji', char: '组' }).success).toBe(true)
  })
})

describe('modelGroupCreateSchema', () => {
  it('trims the name and defaults icon/color to absent', () => {
    expect(modelGroupCreateSchema.parse({ name: '  OpenAI  ' })).toEqual({ name: 'OpenAI' })
  })

  it('lowercases hex colors', () => {
    expect(modelGroupCreateSchema.parse({ name: 'A', color: '#AABBCC' }).color).toBe('#aabbcc')
  })

  it.each([
    ['empty name', { name: '   ' }],
    ['overlong name', { name: 'x'.repeat(41) }],
    ['bad color', { name: 'A', color: 'red' }],
    ['short hex', { name: 'A', color: '#abc' }],
  ])('rejects %s', (_label, value) => {
    expect(modelGroupCreateSchema.safeParse(value).success).toBe(false)
  })
})

describe('modelGroupUpdateSchema', () => {
  it('allows clearing icon and color with null', () => {
    expect(modelGroupUpdateSchema.parse({ icon: null, color: null })).toEqual({
      icon: null,
      color: null,
    })
  })

  it('rejects an empty patch', () => {
    expect(modelGroupUpdateSchema.safeParse({}).success).toBe(false)
  })
})

describe('modelGroupReorderSchema', () => {
  it('accepts a unique id list', () => {
    expect(modelGroupReorderSchema.parse({ groupIds: ['a', 'b'] }).groupIds).toEqual(['a', 'b'])
  })

  it.each([
    ['empty list', { groupIds: [] }],
    ['duplicates', { groupIds: ['a', 'a'] }],
  ])('rejects %s', (_label, value) => {
    expect(modelGroupReorderSchema.safeParse(value).success).toBe(false)
  })
})

describe('modelGroupAssignSchema', () => {
  it('accepts null groupId to move models out of any group', () => {
    expect(modelGroupAssignSchema.parse({ groupId: null, modelIds: ['m1'] })).toEqual({
      groupId: null,
      modelIds: ['m1'],
    })
  })

  it.each([
    ['empty model list', { groupId: 'g', modelIds: [] }],
    ['duplicate models', { groupId: 'g', modelIds: ['m', 'm'] }],
    ['empty group id string', { groupId: '', modelIds: ['m'] }],
    ['over the batch limit', { groupId: 'g', modelIds: Array.from({ length: 1001 }, (_, i) => `m${i}`) }],
  ])('rejects %s', (_label, value) => {
    expect(modelGroupAssignSchema.safeParse(value).success).toBe(false)
  })
})

describe('modelIconBatchSchema', () => {
  it('accepts icon assignments including explicit clears', () => {
    const parsed = modelIconBatchSchema.parse({
      items: [
        { id: 'm1', icon: { type: 'lobe', slug: 'openai' } },
        { id: 'm2', icon: null },
      ],
    })
    expect(parsed.items).toHaveLength(2)
  })

  it('rejects duplicate model ids', () => {
    expect(
      modelIconBatchSchema.safeParse({
        items: [
          { id: 'm1', icon: null },
          { id: 'm1', icon: null },
        ],
      }).success,
    ).toBe(false)
  })
})
