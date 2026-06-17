import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../env'

// 由 APP_ENCRYPTION_KEY 派生 32 字节密钥；Provider API Key 用 AES-256-GCM 落库加密。
const key = createHash('sha256').update(env.APP_ENCRYPTION_KEY).digest()

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, encB64] = stored.split(':')
  if (!ivB64 || !tagB64 || !encB64) throw new Error('密钥数据格式错误')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** 返回密钥尾部用于前端展示（如 ••••cola），绝不返回完整密钥。 */
export function maskSecretTail(plain: string): string {
  return plain.length <= 4 ? '••••' : `••••${plain.slice(-4)}`
}
