import { describe, expect, it } from 'vitest'
import { createRandomUuid } from './randomUuid'

describe('createRandomUuid', () => {
  it('安全上下文优先使用浏览器原生 randomUUID', () => {
    const nativeUuid = '123e4567-e89b-42d3-a456-426614174000'
    let getRandomValuesCalls = 0
    let randomUuidCalls = 0
    const getRandomValues: Crypto['getRandomValues'] = (array) => {
      getRandomValuesCalls += 1
      return array
    }
    const cryptoApi = {
      randomUUID(): ReturnType<Crypto['randomUUID']> {
        randomUuidCalls += 1
        expect(this).toBe(cryptoApi)
        return nativeUuid
      },
      getRandomValues,
    }

    expect(createRandomUuid(cryptoApi)).toBe(nativeUuid)
    expect(randomUuidCalls).toBe(1)
    expect(getRandomValuesCalls).toBe(0)
  })

  it('普通 HTTP 来源回退到 getRandomValues 并生成标准 UUID v4', () => {
    let getRandomValuesCalls = 0
    const getRandomValues: Crypto['getRandomValues'] = (array) => {
      getRandomValuesCalls += 1
      if (!(array instanceof Uint8Array)) throw new TypeError('测试只接受 Uint8Array')
      array.set(Array.from({ length: 16 }, (_, index) => index))
      return array
    }

    expect(createRandomUuid({ getRandomValues })).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(getRandomValuesCalls).toBe(1)
  })
})
