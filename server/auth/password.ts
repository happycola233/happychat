import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// 使用 Node 内置 scrypt（零原生依赖），格式：scrypt$<saltHex>$<hashHex>
const KEY_LEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, KEY_LEN)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const derived = scryptSync(password, salt, expected.length)
  return expected.length === derived.length && timingSafeEqual(derived, expected)
}
