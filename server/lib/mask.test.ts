import { describe, expect, it } from 'vitest'
import { maskSecretTail } from './mask'

describe('maskSecretTail', () => {
  it('只暴露尾部 4 位', () => {
    expect(maskSecretTail('abcdefgh')).toBe('****efgh')
    expect(maskSecretTail('abc')).toBe('****')
  })
})
