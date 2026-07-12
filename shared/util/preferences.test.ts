import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, mergePreferences } from './preferences'

describe('mergePreferences', () => {
  it('matches the default settings for new users', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      autoScrollOnOpen: true,
      showScrollToBottom: true,
      showTimelineNav: true,
      showNewChatGradientGlow: true,
      sendOnEnterDesktop: true,
      sendOnEnterMobile: false,
      defaultExpandReasoning: true,
      accentColor: 'default',
      messageFontSize: 'medium',
      showMessageTime: true,
      messageTimeFormat: 'datetime',
      showModelLabel: true,
      showUsageStats: true,
    })
  })

  it('returns a complete copy of defaults for null/undefined', () => {
    expect(mergePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(mergePreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
  })

  it('overrides provided keys and keeps defaults for the rest', () => {
    const merged = mergePreferences({
      sendOnEnterMobile: true,
      accentColor: 'purple',
      messageFontSize: 'large',
    })
    expect(merged.sendOnEnterMobile).toBe(true)
    expect(merged.accentColor).toBe('purple')
    expect(merged.messageFontSize).toBe('large')
    expect(merged.showModelLabel).toBe(DEFAULT_PREFERENCES.showModelLabel)
  })

  it('migrates the legacy sendOnEnter flag into the desktop setting', () => {
    const merged = mergePreferences({ sendOnEnter: false } as never)
    expect(merged.sendOnEnterDesktop).toBe(false)
    expect(merged.sendOnEnterMobile).toBe(DEFAULT_PREFERENCES.sendOnEnterMobile)
    // 旧键不应残留在合并结果里。
    expect('sendOnEnter' in merged).toBe(false)
  })

  it('prefers the explicit desktop setting over the legacy flag', () => {
    const merged = mergePreferences({ sendOnEnter: false, sendOnEnterDesktop: true } as never)
    expect(merged.sendOnEnterDesktop).toBe(true)
  })

  it('falls back to the default accent color for stale invalid values', () => {
    const merged = mergePreferences({ accentColor: 'cyan' } as never)
    expect(merged.accentColor).toBe('default')
  })

  it('drops unknown/stale keys and yields exactly the known key set', () => {
    const merged = mergePreferences({ webSearch: true, showUsageStats: true } as never)
    expect('webSearch' in merged).toBe(false)
    expect(merged.showUsageStats).toBe(true)
    expect(Object.keys(merged).sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort())
  })
})
