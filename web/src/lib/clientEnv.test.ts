import { describe, expect, it } from 'vitest'
import { describeBrowser, describeClientEnv, describeOS } from './clientEnv'

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  operaMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  safariMojave:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Safari/605.1.15',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  chromeOS:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
}

describe('describeBrowser', () => {
  it('优先匹配 Chromium 衍生浏览器，而不是把它们认成 Chrome', () => {
    expect(describeBrowser(UA.edgeWindows)).toBe('Edge 141')
    expect(describeBrowser(UA.operaMac)).toBe('Opera 125')
  })

  it('识别 Chrome / Firefox / Safari', () => {
    expect(describeBrowser(UA.chromeWindows)).toBe('Chrome 141')
    expect(describeBrowser(UA.firefoxLinux)).toBe('Firefox 143')
    expect(describeBrowser(UA.safariMac)).toBe('Safari 18')
    expect(describeBrowser(UA.safariIphone)).toBe('Safari 18')
  })

  it('无法识别时回退到占位文案', () => {
    expect(describeBrowser('SomeUnknownAgent/1.0')).toBe('未知浏览器')
  })
})

describe('describeOS', () => {
  it('识别桌面系统', () => {
    expect(describeOS({ userAgent: UA.chromeWindows })).toBe('Windows 10/11')
    expect(describeOS({ userAgent: UA.firefoxLinux })).toBe('Linux')
    expect(describeOS({ userAgent: UA.chromeOS })).toBe('ChromeOS')
  })

  it('macOS 11 起 UA 版本被冻结在 10.15，此时不展示数字', () => {
    expect(describeOS({ userAgent: UA.safariMac })).toBe('macOS')
    expect(describeOS({ userAgent: UA.operaMac })).toBe('macOS')
    // 10.15 之前的号段是真实版本，照常展示。
    expect(describeOS({ userAgent: UA.safariMojave })).toBe('macOS 10.14')
  })

  it('识别移动系统，并区分 iPadOS 桌面模式', () => {
    expect(describeOS({ userAgent: UA.safariIphone, platform: 'iPhone' })).toBe('iOS 18.5')
    expect(describeOS({ userAgent: UA.chromeAndroid })).toBe('Android 16')
    expect(describeOS({ userAgent: UA.safariMac, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(
      'iPadOS',
    )
  })

  it('无法识别时回退到占位文案', () => {
    expect(describeOS({ userAgent: 'SomeUnknownAgent/1.0' })).toBe('未知系统')
    expect(describeOS({})).toBe('未知系统')
  })
})

describe('describeClientEnv', () => {
  it('同时返回浏览器与系统', () => {
    expect(describeClientEnv({ userAgent: UA.edgeWindows, platform: 'Win32' })).toEqual({
      browser: 'Edge 141',
      os: 'Windows 10/11',
    })
  })
})
