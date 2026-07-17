import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getUserAvatarUrl } from './users'

describe('getUserAvatarUrl', () => {
  it('returns null when the user has not uploaded an avatar', () => {
    expect(getUserAvatarUrl({ id: 'user-1', avatarPath: null })).toBeNull()
  })

  it('uses the uploaded filename as a cache-busting version', () => {
    const avatarPath = join('data', 'uploads', 'user-1', 'fresh-avatar.webp')

    expect(getUserAvatarUrl({ id: 'user-1', avatarPath })).toBe(
      '/api/auth/avatar/user-1?v=fresh-avatar.webp',
    )
  })
})
