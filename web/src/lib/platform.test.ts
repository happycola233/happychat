import { describe, expect, it } from 'vitest'
import { isIOSLikePlatform } from './platform'

describe('isIOSLikePlatform', () => {
  it('detects iPhone and iPad user agents', () => {
    expect(
      isIOSLikePlatform({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
        platform: 'iPhone',
        maxTouchPoints: 5,
      }),
    ).toBe(true)

    expect(
      isIOSLikePlatform({
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
        platform: 'iPad',
        maxTouchPoints: 5,
      }),
    ).toBe(true)
  })

  it('detects iPadOS desktop mode without matching Android', () => {
    expect(
      isIOSLikePlatform({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe(true)

    expect(
      isIOSLikePlatform({
        userAgent:
          'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      }),
    ).toBe(false)
  })
})
