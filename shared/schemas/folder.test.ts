import { describe, expect, it } from 'vitest'
import { createFolderSchema, updateFolderSchema } from './folder'

describe('createFolderSchema', () => {
  it('accepts a full payload and trims the name', () => {
    const parsed = createFolderSchema.parse({
      name: '  工作  ',
      color: '#0EA5E9',
      emoji: '📁',
    })
    expect(parsed).toEqual({ name: '工作', color: '#0EA5E9', emoji: '📁' })
  })

  it('accepts nullish color and emoji (defaults)', () => {
    expect(createFolderSchema.parse({ name: '默认' })).toEqual({ name: '默认' })
    expect(createFolderSchema.parse({ name: '默认', color: null, emoji: null })).toEqual({
      name: '默认',
      color: null,
      emoji: null,
    })
  })

  it('accepts multi-codepoint emoji (ZWJ sequences)', () => {
    expect(createFolderSchema.safeParse({ name: 'x', emoji: '👨‍👩‍👧‍👦' }).success).toBe(true)
  })

  it('rejects empty or overlong names', () => {
    expect(createFolderSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(createFolderSchema.safeParse({ name: 'a'.repeat(41) }).success).toBe(false)
  })

  it('rejects malformed colors', () => {
    for (const color of ['red', '#123', '#12345', '#12345g', '0ea5e9']) {
      expect(createFolderSchema.safeParse({ name: 'x', color }).success).toBe(false)
    }
  })

  it('rejects multi-grapheme text masquerading as an emoji icon', () => {
    expect(createFolderSchema.safeParse({ name: 'x', emoji: '不是表情' }).success).toBe(false)
    expect(createFolderSchema.safeParse({ name: 'x', emoji: 'ab' }).success).toBe(false)
  })

  it('allows a single non-emoji character as the icon (Notion 式字母/汉字图标)', () => {
    expect(createFolderSchema.safeParse({ name: 'x', emoji: '工' }).success).toBe(true)
  })
})

describe('updateFolderSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateFolderSchema.safeParse({}).success).toBe(false)
  })

  it('accepts partial updates including explicit null to clear', () => {
    expect(updateFolderSchema.parse({ pinned: true })).toEqual({ pinned: true })
    expect(updateFolderSchema.parse({ color: null, emoji: null })).toEqual({
      color: null,
      emoji: null,
    })
  })
})
