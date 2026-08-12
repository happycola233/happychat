import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

// 使用 Node 内置 scrypt（零原生依赖），格式：scrypt$<saltHex>$<hashHex>
const KEY_LEN = 64

// 去掉 I/l/O/o/0/1 等易混淆字符；16 个随机字符约有 92 bit 熵，分组后便于人工转交。
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const TEMPORARY_PASSWORD_GROUP_COUNT = 4
const TEMPORARY_PASSWORD_GROUP_LENGTH = 4

export function generateTemporaryPassword(): string {
  return Array.from({ length: TEMPORARY_PASSWORD_GROUP_COUNT }, () =>
    Array.from(
      { length: TEMPORARY_PASSWORD_GROUP_LENGTH },
      () => TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)],
    ).join(''),
  ).join('-')
}

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
