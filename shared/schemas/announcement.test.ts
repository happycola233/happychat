import { describe, expect, it } from 'vitest'
import { announcementCreateSchema, announcementUpdateSchema } from './announcement'

describe('announcement audience schema', () => {
  it('defaults new announcements to all users with an empty explicit list', () => {
    expect(announcementCreateSchema.parse({ title: '通知', body: '正文' })).toMatchObject({
      audience: 'all',
      userIds: [],
    })
  })

  it('requires at least one concrete user for selected audience', () => {
    expect(
      announcementCreateSchema.safeParse({
        title: '定向通知',
        body: '正文',
        audience: 'selected',
        userIds: [],
      }).success,
    ).toBe(false)
    expect(
      announcementUpdateSchema.safeParse({ audience: 'selected', userIds: ['user-1'] }).success,
    ).toBe(true)
    expect(announcementUpdateSchema.safeParse({ audience: 'selected' }).success).toBe(false)
  })

  it('rejects duplicate target IDs', () => {
    const result = announcementCreateSchema.safeParse({
      title: '定向通知',
      body: '正文',
      audience: 'selected',
      userIds: ['user-1', 'user-1'],
    })
    expect(result.success).toBe(false)
  })
})
