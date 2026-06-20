import { describe, expect, it } from 'vitest'
import { titleLocaleFromBrowser } from './titleLocale'

describe('title locale formatting', () => {
  it('maps Chinese browser locales to explicit Chinese variants', () => {
    expect(titleLocaleFromBrowser('zh-CN')).toBe('简体中文')
    expect(titleLocaleFromBrowser('zh-Hans-SG')).toBe('简体中文')
    expect(titleLocaleFromBrowser('zh-TW')).toBe('繁體中文')
    expect(titleLocaleFromBrowser('zh-Hant-HK')).toBe('繁體中文')
  })

  it('keeps non-Chinese locales readable while preserving the browser locale tag', () => {
    expect(titleLocaleFromBrowser('en-US')).toContain('(en-US)')
    expect(titleLocaleFromBrowser('ja-JP')).toContain('(ja-JP)')
  })

  it('falls back to Simplified Chinese for missing or invalid browser locales', () => {
    expect(titleLocaleFromBrowser(undefined)).toBe('简体中文')
    expect(titleLocaleFromBrowser('not a locale')).toBe('简体中文')
  })
})
