import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, maskSecretTail } from './crypto'

describe('crypto', () => {
  it('加密后能正确解密', () => {
    const secret = 'happychat-super-secret'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })
  it('两次加密的密文不同（随机 IV）', () => {
    expect(encryptSecret('abc')).not.toBe(encryptSecret('abc'))
  })
  it('掩码只暴露尾部 4 位', () => {
    expect(maskSecretTail('abcdefgh')).toBe('••••efgh')
    expect(maskSecretTail('abc')).toBe('••••')
  })
})
