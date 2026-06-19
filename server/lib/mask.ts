const MASKED_SECRET = '********'

/** 返回固定星号用于列表展示，不暴露密钥内容或长度。 */
export function maskSecret(plain: string): string {
  return plain ? MASKED_SECRET : ''
}
