import { describe, expect, it } from 'vitest'
import { normalizeModelTags } from './modelTags'

describe('normalizeModelTags', () => {
  it('upgrades legacy strings and canonicalizes custom colors', () => {
    expect(
      normalizeModelTags([
        ' 内测 ',
        { label: '推荐', color: '#ABCDEF' },
        { label: '自动', color: null },
      ]),
    ).toEqual([
      { label: '内测', color: null },
      { label: '推荐', color: '#abcdef' },
      { label: '自动', color: null },
    ])
  })

  it('drops invalid labels and makes invalid stored colors safe', () => {
    expect(
      normalizeModelTags([
        { label: '安全回退', color: 'red; background:url(evil)' },
        { label: '安全回退', color: '#ffffff' },
        '',
        null,
      ]),
    ).toEqual([{ label: '安全回退', color: null }])
  })
})
