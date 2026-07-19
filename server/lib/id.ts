import { randomBytes } from 'node:crypto'
import { v7 } from 'uuid'

/** 生成 UUIDv7（时间有序，利于索引局部性与按创建顺序排序）。服务端数据库主键统一使用。 */
export const newId = (): string => v7()

// 去除易混淆字符（无 I/O/0/1）
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 生成邀请码（默认 8 位大写字母数字）。 */
export function genInviteCode(len = 8): string {
  const b = randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[b[i]! % CODE_ALPHABET.length]
  return s
}

/**
 * 生成公开分享链接 token：128 位全随机、URL 安全。
 * 不复用 UUIDv7——其时间戳前缀可预测，作为无鉴权访问凭证熵不足。
 */
export function genShareToken(): string {
  return randomBytes(16).toString('base64url')
}
