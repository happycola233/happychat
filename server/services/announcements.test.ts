import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { announcementCreateSchema } from '@shared/schemas/announcement'

let temporaryDirectory: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let services: typeof import('./announcements')
let fixtureSequence = 0

beforeAll(async () => {
  const temporaryRoot = resolve('.tmp')
  mkdirSync(temporaryRoot, { recursive: true })
  temporaryDirectory = mkdtempSync(join(temporaryRoot, 'announcements-test-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-announcements'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  services = await import('./announcements')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function createUser(role: 'admin' | 'user' = 'user') {
  const sequence = fixtureSequence++
  const id = `announcement-user-${sequence}`
  await dbClient.db.insert(schema.users).values({
    id,
    username: id,
    passwordHash: 'hash',
    role,
  })
  const [user] = await dbClient.db.select().from(schema.users).where(eq(schema.users.id, id))
  if (!user) throw new Error('user fixture missing')
  return user
}

describe('announcement exact audience', () => {
  it('shows a selected announcement only to its concrete targets without an admin bypass', async () => {
    const creator = await createUser('admin')
    const target = await createUser()
    const other = await createUser()
    const created = await services.createAnnouncement(
      announcementCreateSchema.parse({
        title: '精确推送',
        body: '仅目标用户可见',
        audience: 'selected',
        userIds: [target.id],
        status: 'published',
      }),
      creator.id,
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect((await services.listActiveForUser(target)).map((item) => item.id)).toContain(
      created.announcement.id,
    )
    expect((await services.listActiveForUser(other)).map((item) => item.id)).not.toContain(
      created.announcement.id,
    )
    expect((await services.listActiveForUser(creator)).map((item) => item.id)).not.toContain(
      created.announcement.id,
    )

    expect(await services.markAnnouncementRead(created.announcement.id, other)).toBe(false)
    expect(await services.markAnnouncementRead(created.announcement.id, creator)).toBe(false)
    expect(
      await dbClient.db
        .select()
        .from(schema.announcementReads)
        .where(eq(schema.announcementReads.announcementId, created.announcement.id)),
    ).toEqual([])
    expect(await services.markAnnouncementRead(created.announcement.id, target)).toBe(true)
    expect(
      await dbClient.db
        .select()
        .from(schema.announcementReads)
        .where(eq(schema.announcementReads.announcementId, created.announcement.id)),
    ).toHaveLength(1)

    const detail = await services.getAdminAnnouncement(created.announcement.id)
    expect(detail).toMatchObject({ audience: 'selected', audienceCount: 1, readCount: 1 })
    expect(await services.listAnnouncementReaders(created.announcement.id)).toMatchObject([
      { userId: target.id },
    ])
  })

  it('atomically replaces targets and filters historical reads by the current audience', async () => {
    const creator = await createUser('admin')
    const firstTarget = await createUser()
    const secondTarget = await createUser()
    const created = await services.createAnnouncement(
      announcementCreateSchema.parse({
        title: '更换受众',
        body: '正文',
        audience: 'selected',
        userIds: [firstTarget.id],
        status: 'published',
      }),
      creator.id,
    )
    if (!created.ok) throw new Error('announcement fixture missing')
    await services.markAnnouncementRead(created.announcement.id, firstTarget)

    const updated = await services.updateAnnouncement(created.announcement.id, {
      audience: 'selected',
      userIds: [secondTarget.id],
    })
    expect(updated.ok).toBe(true)
    expect(await services.getAnnouncementAudience(created.announcement.id)).toEqual({
      audience: 'selected',
      userIds: [secondTarget.id],
    })
    expect(await services.listAnnouncementReaders(created.announcement.id)).toEqual([])
    expect(await services.getAdminAnnouncement(created.announcement.id)).toMatchObject({
      audienceCount: 1,
      readCount: 0,
    })
    expect((await services.listActiveForUser(firstTarget)).map((item) => item.id)).not.toContain(
      created.announcement.id,
    )
    expect((await services.listActiveForUser(secondTarget)).map((item) => item.id)).toContain(
      created.announcement.id,
    )

    const rejected = await services.updateAnnouncement(created.announcement.id, {
      audience: 'selected',
      userIds: ['deleted-user'],
    })
    expect(rejected).toEqual({
      ok: false,
      code: 'unknown_users',
      unknownUserIds: ['deleted-user'],
    })
    expect(await services.getAnnouncementAudience(created.announcement.id)).toEqual({
      audience: 'selected',
      userIds: [secondTarget.id],
    })
  })

  it('keeps all-user announcements dynamic and clears stale target rows', async () => {
    const creator = await createUser('admin')
    const initialTarget = await createUser()
    const created = await services.createAnnouncement(
      announcementCreateSchema.parse({
        title: '全体推送',
        body: '正文',
        audience: 'selected',
        userIds: [initialTarget.id],
        status: 'published',
      }),
      creator.id,
    )
    if (!created.ok) throw new Error('announcement fixture missing')

    const updated = await services.updateAnnouncement(created.announcement.id, {
      audience: 'all',
      userIds: [],
    })
    expect(updated.ok).toBe(true)
    expect(await services.getAnnouncementAudience(created.announcement.id)).toEqual({
      audience: 'all',
      userIds: [],
    })
    const futureUser = await createUser()
    expect((await services.listActiveForUser(futureUser)).map((item) => item.id)).toContain(
      created.announcement.id,
    )
    const targetRows = await dbClient.db
      .select()
      .from(schema.announcementUserTargets)
      .where(eq(schema.announcementUserTargets.announcementId, created.announcement.id))
    expect(targetRows).toEqual([])
  })

  it('does not let read-all bypass an explicit modal acknowledgement', async () => {
    const creator = await createUser('admin')
    const target = await createUser()
    const created = await services.createAnnouncement(
      announcementCreateSchema.parse({
        title: '必须确认',
        body: '强提示正文',
        channel: 'modal',
        audience: 'selected',
        userIds: [target.id],
        status: 'published',
      }),
      creator.id,
    )
    if (!created.ok) throw new Error('announcement fixture missing')

    await services.markAllAnnouncementsRead(target)
    expect(
      (await services.listActiveForUser(target)).find(
        (announcement) => announcement.id === created.announcement.id,
      ),
    ).toMatchObject({ read: false })

    expect(await services.markAnnouncementRead(created.announcement.id, target)).toBe(true)
    expect(
      (await services.listActiveForUser(target)).find(
        (announcement) => announcement.id === created.announcement.id,
      ),
    ).toMatchObject({ read: true })
  })
})
