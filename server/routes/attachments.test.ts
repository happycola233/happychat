import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AttachmentDTO, UserSettingsDTO } from '@shared/types/api'
import type { AppEnv } from '../http/types'

let directory: string
let app: Hono<AppEnv>
let client: typeof import('../db/client')
let schema: typeof import('../db/schema')
let cookie: string
let png: Buffer

beforeAll(async () => {
  const root = resolve('.tmp')
  mkdirSync(root, { recursive: true })
  directory = mkdtempSync(join(root, 'attachment-compression-test-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DATA_DIR', directory)
  vi.stubEnv('DATABASE_URL', join(directory, 'test.db'))
  vi.stubEnv('SESSION_SECRET', 'attachment-compression-test-only')
  vi.resetModules()
  client = await import('../db/client')
  schema = await import('../db/schema')
  const { runMigrations } = await import('../db/migrate')
  runMigrations()
  client.db
    .insert(schema.users)
    .values({ id: 'uploader', username: 'uploader', passwordHash: 'unused' })
    .run()
  const { createSession } = await import('../auth/session')
  const login = new Hono().get('/', async (c) => {
    await createSession(c, 'uploader')
    return c.body(null, 204)
  })
  cookie = (await login.request('/')).headers.get('set-cookie')!.split(';')[0]!
  const { attachmentRoutes } = await import('./attachments')
  const { authRoutes } = await import('./auth')
  app = new Hono<AppEnv>()
    .route('/api/attachments', attachmentRoutes)
    .route('/api/auth', authRoutes)
  png = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#458fe2' } })
    .png({ compressionLevel: 0 })
    .toBuffer()
})

afterAll(() => {
  client?.sqlite.close()
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function upload(buffer: Buffer, filename: string, mime: string) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(buffer)], filename, { type: mime }))
  const response = await app.request('/api/attachments', {
    method: 'POST',
    body: form,
    headers: { Cookie: cookie },
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as { attachment: AttachmentDTO }).attachment
}

describe('chat attachment compression preference', () => {
  it('没有偏好的旧账号默认压缩，落盘/DTO/下载内容/哈希一致，读取不再转码', async () => {
    const settings = await app.request('/api/auth/settings', { headers: { Cookie: cookie } })
    const initialSettings = (await settings.json()) as { settings: UserSettingsDTO }
    expect(initialSettings.settings.preferences.compressUploadedImages).toBe(true)
    const attachment = await upload(png, 'photo.PNG', 'application/octet-stream')
    expect(attachment).toMatchObject({ filename: 'photo.webp', mime: 'image/webp', kind: 'image' })
    expect(attachment.byteSize).toBeLessThan(png.length)
    const row = client.db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.id, attachment.id))
      .get()!
    const stored = readFileSync(row.storagePath)
    expect(row.storagePath).toMatch(/\.webp$/)
    expect(row.byteSize).toBe(stored.length)
    expect(attachment.byteSize).toBe(stored.length)
    expect(row.sha256).toBe(createHash('sha256').update(stored).digest('hex'))
    expect(await sharp(stored).metadata()).toMatchObject({ width: 240, height: 160 })
    for (let index = 0; index < 2; index++) {
      const download = await app.request(`/api/attachments/${attachment.id}`, {
        headers: { Cookie: cookie },
      })
      expect(download.headers.get('content-type')).toBe('image/webp')
      expect(Buffer.from(await download.arrayBuffer())).toEqual(stored)
    }
  })

  it('关闭后按原图保存，设置重新读取仍为关闭，再打开后恢复压缩', async () => {
    for (const enabled of [false, true]) {
      const update = await app.request('/api/auth/settings', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { compressUploadedImages: enabled } }),
      })
      expect(update.status).toBe(200)
      const settings = await app.request('/api/auth/settings', { headers: { Cookie: cookie } })
      const persistedSettings = (await settings.json()) as { settings: UserSettingsDTO }
      expect(persistedSettings.settings.preferences.compressUploadedImages).toBe(enabled)
      const attachment = await upload(png, 'original.png', 'image/png')
      expect(attachment.mime).toBe(enabled ? 'image/webp' : 'image/png')
      if (!enabled) {
        expect(attachment).toMatchObject({ filename: 'original.png', byteSize: png.length })
        const row = client.db
          .select()
          .from(schema.attachments)
          .where(eq(schema.attachments.id, attachment.id))
          .get()!
        expect(readFileSync(row.storagePath)).toEqual(png)
      }
    }
  })

  it('普通文件继续原样上传', async () => {
    const bytes = Buffer.from('Synthetic test document')
    const attachment = await upload(bytes, 'notes.txt', 'text/plain')
    expect(attachment).toMatchObject({
      kind: 'file',
      mime: 'text/plain',
      filename: 'notes.txt',
      byteSize: bytes.length,
    })
  })
})
