import { describe, expect, it } from 'vitest'
import { maskSecret } from './mask'

describe('maskSecret', () => {
  it('用固定星号脱敏，不暴露真实内容或长度', () => {
    expect(maskSecret('abcdefgh')).toBe('********')
    expect(maskSecret('abc')).toBe('********')
    expect(maskSecret('')).toBe('')
  })
})
