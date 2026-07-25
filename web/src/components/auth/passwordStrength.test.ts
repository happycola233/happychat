import { describe, expect, it } from 'vitest'
import { scorePasswordStrength } from './passwordStrength'

describe('scorePasswordStrength', () => {
  it('空密码不给出任何强度（用于隐藏指示条）', () => {
    expect(scorePasswordStrength('')).toBe(0)
  })

  it('未达 6 位下限一律为最弱', () => {
    expect(scorePasswordStrength('a')).toBe(1)
    expect(scorePasswordStrength('abcde')).toBe(1)
  })

  it('刚够 6 位的单一字符类型仍是弱', () => {
    expect(scorePasswordStrength('abcdef')).toBe(1)
    expect(scorePasswordStrength('123456')).toBe(1)
  })

  it('混用字符类型能逐级加分（第 4 种类型不再额外加分，长度才是主因）', () => {
    expect(scorePasswordStrength('abcdef1')).toBe(2)
    expect(scorePasswordStrength('Abcdef1')).toBe(3)
    expect(scorePasswordStrength('Abcdef1!')).toBe(3)
    expect(scorePasswordStrength('Abcdef1!23')).toBe(4)
  })

  it('足够长的单一类型密码也能到较强', () => {
    expect(scorePasswordStrength('abcdefghij')).toBe(2)
    expect(scorePasswordStrength('abcdefghijklmn')).toBe(3)
  })

  it('非 ASCII 字符计入「符号」类型', () => {
    expect(scorePasswordStrength('密码密码密码')).toBe(1)
    expect(scorePasswordStrength('密码abc123')).toBe(3)
  })

  it('封顶为 4 档', () => {
    expect(scorePasswordStrength('Aa1!Aa1!Aa1!Aa1!Aa1!')).toBe(4)
  })
})
