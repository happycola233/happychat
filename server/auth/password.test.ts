import { describe, expect, it } from 'vitest'
import { generateTemporaryPassword, hashPassword, verifyPassword } from './password'

describe('password helpers', () => {
  it('hashes passwords with unique salts and verifies the original value', () => {
    const first = hashPassword('same-password')
    const second = hashPassword('same-password')

    expect(first).not.toBe(second)
    expect(verifyPassword('same-password', first)).toBe(true)
    expect(verifyPassword('wrong-password', first)).toBe(false)
  })

  it('generates grouped, unambiguous, non-repeating temporary passwords', () => {
    const generated = new Set(Array.from({ length: 100 }, generateTemporaryPassword))

    expect(generated.size).toBe(100)
    for (const password of generated) {
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{4}(?:-[A-HJ-NP-Za-km-np-z2-9]{4}){3}$/)
      expect(password).not.toMatch(/[IlOo01]/)
    }
  })
})
