import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { attachments } from '../db/schema'
import { requireUser } from '../auth/middleware'
import { newId } from '../lib/id'
import {
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  isImageMime,
  readUpload,
  saveUpload,
  sha256,
} from '../storage/files'
import type { AppEnv } from '../http/types'

export const attachmentRoutes = new Hono<AppEnv>()

attachmentRoutes.use('*', requireUser)

attachmentRoutes.post('/', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    return c.json({ error: { message: '未收到文件', code: 'no_file' } }, 400)
  }
  const kind = isImageMime(file.type) ? 'image' : 'file'
  const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
  if (file.size > limit) {
    return c.json(
      { error: { message: `文件过大，最大 ${Math.floor(limit / 1024 / 1024)}MB`, code: 'too_large' } },
      400,
    )
  }
  if (file.size === 0) {
    return c.json({ error: { message: '文件为空', code: 'empty' } }, 400)
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const id = newId()
  const filename = file.name || (kind === 'image' ? 'image' : 'file')
  const mime = file.type || 'application/octet-stream'
  const storagePath = saveUpload(id, filename, mime, buf)

  await db.insert(attachments).values({
    id,
    userId: c.get('user').id,
    kind,
    mime,
    filename,
    byteSize: file.size,
    storagePath,
    sha256: sha256(buf),
  })

  return c.json({ attachment: { id, kind, mime, filename, byteSize: file.size } })
})

attachmentRoutes.get('/:id', async (c) => {
  const [a] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, c.req.param('id')), eq(attachments.userId, c.get('user').id)))
    .limit(1)
  if (!a) return c.json({ error: { message: '附件不存在', code: 'not_found' } }, 404)
  try {
    const buf = readUpload(a.storagePath)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': a.mime,
        'Content-Disposition': `inline; filename="${encodeURIComponent(a.filename)}"`,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return c.json({ error: { message: '附件文件缺失', code: 'file_missing' } }, 404)
  }
})
