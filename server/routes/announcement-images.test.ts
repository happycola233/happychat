import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { announcementCreateSchema } from '@shared/schemas/announcement'
import {
  announcementImageMarkup,
  type AnnouncementImageDTO,
} from '@shared/schemas/announcement-image'
import type { AppEnv } from '../http/types'

let directory: string
let app: Hono<AppEnv>
let client: typeof import('../db/client')
let schema: typeof import('../db/schema')
let announcements: typeof import('../services/announcements')
let images: typeof import('../services/announcement-images')
const cookies: Record<string, string> = {}
let png: Buffer

beforeAll(async () => {
  const root = resolve('.tmp')
  mkdirSync(root, { recursive: true })
  directory = mkdtempSync(join(root, 'announcement-image-test-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = directory
  process.env.DATABASE_URL = join(directory, 'test.db')
  process.env.SESSION_SECRET = 'announcement-image-test-only'
  vi.resetModules()
  const migration = await import('../db/migrate')
  client = await import('../db/client')
  schema = await import('../db/schema')
  migration.runMigrations()
  announcements = await import('../services/announcements')
  images = await import('../services/announcement-images')
  const { createSession } = await import('../auth/session')
  for (const id of ['admin', 'reader', 'outsider']) {
    client.db
      .insert(schema.users)
      .values({ id, username: id, passwordHash: 'unused', role: id === 'admin' ? 'admin' : 'user' })
      .run()
    const login = new Hono().get('/', async (c) => {
      await createSession(c, id)
      return c.body(null, 204)
    })
    cookies[id] = (await login.request('/')).headers.get('set-cookie')!.split(';')[0]!
  }
  const { adminAnnouncementImageRoutes, announcementImageRoutes } =
    await import('./announcement-images')
  app = new Hono<AppEnv>()
  app.route('/api/admin/announcement-images', adminAnnouncementImageRoutes)
  app.route('/api/announcements/images', announcementImageRoutes)
  png = await sharp({ create: { width: 120, height: 80, channels: 4, background: '#3182ce' } })
    .png()
    .toBuffer()
})

afterAll(() => {
  client?.sqlite.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function upload(bytes = png, mime = 'image/png', user = 'admin') {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], 'example.png', { type: mime }))
  return app.request('/api/admin/announcement-images', {
    method: 'POST',
    body: form,
    headers: { Cookie: cookies[user] ?? '' },
  })
}
const read = (image: AnnouncementImageDTO, user: string) =>
  app.request(image.url, { headers: { Cookie: cookies[user] ?? '' } })
async function newImage() {
  const response = await upload()
  expect(response.status).toBe(201)
  return ((await response.json()) as { image: AnnouncementImageDTO }).image
}
async function publish(image: AnnouncementImageDTO, extra = {}) {
  const result = await announcements.createAnnouncement(
    announcementCreateSchema.parse({
      title: '图片测试公告',
      body: announcementImageMarkup({ src: image.url, alt: '示例', width: 480 }),
      audience: 'selected',
      userIds: ['reader'],
      status: 'published',
      ...extra,
    }),
    'admin',
  )
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.code)
  return result.announcement
}

describe('announcement image upload and access', () => {
  it('requires an administrator, validates decoded content and returns an oriented safe image', async () => {
    expect((await upload(png, 'image/png', 'outsider')).status).toBe(403)
    expect((await upload(png, 'image/png', 'anonymous')).status).toBe(401)
    expect(
      (
        await upload(
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>'),
        )
      ).status,
    ).toBe(400)
    expect((await upload(Buffer.from('broken image'))).status).toBe(400)
    const response = await upload(
      await sharp(png).withMetadata({ orientation: 6 }).jpeg().toBuffer(),
      'image/jpeg',
    )
    const image = ((await response.json()) as { image: AnnouncementImageDTO }).image
    expect(image).toMatchObject({ width: 80, height: 120 })
    const result = await read(image, 'admin')
    expect(result.headers.get('content-type')).toBe('image/webp')
    const metadata = await sharp(Buffer.from(await result.arrayBuffer())).metadata()
    expect(metadata.exif).toBeUndefined()
  })

  it('protects unsaved, draft, future, expired and withdrawn images, including cached reads', async () => {
    const image = await newImage()
    expect((await read(image, 'reader')).status).toBe(404)
    expect((await read(image, 'admin')).status).toBe(200)
    const announcement = await publish(image, { status: 'draft' })
    expect((await read(image, 'reader')).status).toBe(404)
    await announcements.updateAnnouncement(announcement.id, {
      status: 'published',
      publishAt: Date.now() + 100000,
    })
    expect((await read(image, 'reader')).status).toBe(404)
    await announcements.updateAnnouncement(announcement.id, { publishAt: null })
    const allowed = await read(image, 'reader')
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('cache-control')).toBe('private, no-store')
    expect((await read(image, 'outsider')).status).toBe(404)
    expect((await read(image, 'anonymous')).status).toBe(401)
    await announcements.updateAnnouncement(announcement.id, { userIds: ['outsider'] })
    expect((await read(image, 'reader')).status).toBe(404)
    expect((await read(image, 'outsider')).status).toBe(200)
    await announcements.updateAnnouncement(announcement.id, { expiresAt: Date.now() - 1 })
    expect((await read(image, 'outsider')).status).toBe(404)
    await announcements.updateAnnouncement(announcement.id, { expiresAt: null, status: 'draft' })
    expect((await read(image, 'outsider')).status).toBe(404)
  })

  it('keeps shared and draft references while cleaning abandoned uploads after 24 hours', async () => {
    const shared = await newImage()
    const orphan = await newImage()
    const first = await publish(shared)
    const second = await publish(shared, { status: 'draft' })
    const future = new Date(Date.now() + 25 * 60 * 60 * 1000)
    const orphanPath = client.db
      .select()
      .from(schema.announcementImages)
      .where(eq(schema.announcementImages.id, orphan.id))
      .get()!.storagePath
    expect(images.cleanupUnusedAnnouncementImages()).toBe(0)
    images.cleanupUnusedAnnouncementImages(future)
    expect(existsSync(orphanPath)).toBe(false)
    await announcements.deleteAnnouncement(first.id)
    images.cleanupUnusedAnnouncementImages(future)
    expect((await read(shared, 'admin')).status).toBe(200)
    await announcements.updateAnnouncement(second.id, { body: '图片已移除' })
    images.cleanupUnusedAnnouncementImages(future)
    expect((await read(shared, 'admin')).status).toBe(404)
  })

  it('rejects missing image references without partially saving the announcement', async () => {
    const image = await newImage()
    const announcement = await publish(image)
    const body = '<img src="/api/announcements/images/01994a8e-3d09-7777-8aaa-0123456789ab">'
    expect(
      await announcements.updateAnnouncement(announcement.id, { title: '不应保存', body }),
    ).toMatchObject({ ok: false, code: 'unknown_images' })
    expect((await announcements.getAdminAnnouncement(announcement.id))?.title).toBe(
      announcement.title,
    )
    expect((await read(image, 'reader')).status).toBe(200)
  })
})
