import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, mergePreferences } from './preferences'

describe('mergePreferences', () => {
  it('matches the default settings for new users', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      autoScrollOnOpen: true,
      showScrollToBottom: true,
      sendOnEnter: true,
      defaultExpandReasoning: true,
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
    const merged = mergePreferences({ sendOnEnter: false, messageFontSize: 'large' })
    expect(merged.sendOnEnter).toBe(false)
    expect(merged.messageFontSize).toBe('large')
    expect(merged.showModelLabel).toBe(DEFAULT_PREFERENCES.showModelLabel)
  })

  it('drops unknown/stale keys and yields exactly the known key set', () => {
    const merged = mergePreferences({ webSearch: true, showUsageStats: true } as never)
    expect('webSearch' in merged).toBe(false)
    expect(merged.showUsageStats).toBe(true)
    expect(Object.keys(merged).sort()).toEqual(Object.keys(DEFAULT_PREFERENCES).sort())
  })
})
