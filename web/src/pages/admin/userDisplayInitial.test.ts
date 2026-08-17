import { describe, expect, it } from 'vitest'
import { userDisplayInitial } from './userDisplayInitial'

describe('userDisplayInitial', () => {
  it('优先用显示名的第一个字素，并按中文区域大写', () => {
    expect(userDisplayInitial('alice', '李明')).toBe('李')
    expect(userDisplayInitial('alice', 'bob')).toBe('B')
  })

  it('空显示名与模型授权名单一样回退用户名，而不是问号', () => {
    expect(userDisplayInitial('alice', null)).toBe('A')
    expect(userDisplayInitial('alice', '')).toBe('A')
    expect(userDisplayInitial('alice', '   ')).toBe('A')
  })

  it('用户名也空时才用问号', () => {
    expect(userDisplayInitial('', null)).toBe('?')
    expect(userDisplayInitial('   ', '')).toBe('?')
  })
})
