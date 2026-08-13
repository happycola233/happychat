const UUID_BYTE_LENGTH = 16

type RandomUuidCrypto = Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>>

/**
 * 生成浏览器端 UUID v4。
 * `randomUUID` 只在安全上下文暴露；普通 HTTP 局域网地址回退到不受该限制的
 * `getRandomValues`，避免附件上传在发出请求前中断。
 */
export function createRandomUuid(cryptoApi: RandomUuidCrypto = globalThis.crypto): string {
  if (typeof cryptoApi.randomUUID === 'function') {
    // Web API 方法可能依赖自身作为 receiver，不能解构后直接调用。
    return cryptoApi.randomUUID.call(cryptoApi)
  }

  const bytes = new Uint8Array(UUID_BYTE_LENGTH)
  cryptoApi.getRandomValues(bytes)

  // RFC 4122 / RFC 9562 UUID v4：固定 version=4 与 variant=10，其余 122 位保持随机。
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
