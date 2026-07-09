import { describe, expect, it } from 'vitest'
import { updateProfileSchema, updateSettingsSchema } from './settings'

describe('updateProfileSchema', () => {
  it('allows updating only the username', () => {
    const parsed = updateProfileSchema.parse({ username: '  new_name  ' })
    expect(parsed).toEqual({ username: 'new_name' })
  })

  it('allows updating only the display name', () => {
    const parsed = updateProfileSchema.parse({ displayName: '  可乐  ' })
    expect(parsed).toEqual({ displayName: '可乐' })
  })

  it('rejects invalid usernames', () => {
    expect(updateProfileSchema.safeParse({ username: 'bad name' }).success).toBe(false)
  })

  it('rejects empty profile patches', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false)
  })
})

describe('updateSettingsSchema', () => {
  it('allows updating the accent color preference', () => {
    const parsed = updateSettingsSchema.parse({ preferences: { accentColor: 'purple' } })
    expect(parsed).toEqual({ preferences: { accentColor: 'purple' } })
  })

  it('allows toggling the new chat gradient glow preference', () => {
    const parsed = updateSettingsSchema.parse({
      preferences: { showNewChatGradientGlow: false },
    })
    expect(parsed).toEqual({ preferences: { showNewChatGradientGlow: false } })
  })

  it('rejects unknown accent colors', () => {
    expect(
      updateSettingsSchema.safeParse({ preferences: { accentColor: 'cyan' } }).success,
    ).toBe(false)
  })
})
