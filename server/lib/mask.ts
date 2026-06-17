/** 返回密钥尾部用于前端展示（如 ****cola），绝不返回完整密钥。 */
export function maskSecretTail(plain: string): string {
  return plain.length <= 4 ? '****' : `****${plain.slice(-4)}`
}
