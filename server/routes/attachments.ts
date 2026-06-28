import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { attachments } from '../db/schema'
import { requireUser } from '../auth/middleware'
import { newId } from '../lib/id'
import {
  MAX_FILE_INPUT_BYTES,
  MAX_IMAGE_BYTES,
  isImageMime,
  readUpload,
  saveUpload,
  sha256,
  uploadMime,
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

  const filename = file.name || 'file'
  const mime = uploadMime(filename, file.type)
  if (!mime) {
    return c.json(
      {
        error: {
          message: '不支持的文件类型，请上传 PDF、Office、表格、文本、代码或常见图片文件',
          code: 'unsupported_file_type',
        },
      },
      400,
    )
  }

  const kind = isImageMime(mime) ? 'image' : 'file'
  const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_INPUT_BYTES
  // File inputs 的 50 MB 是严格上限；图片仍沿用原有的 32 MB（含边界）限制。
  const tooLarge = kind === 'file' ? file.size >= limit : file.size > limit
  if (tooLarge) {
    const message =
      kind === 'file'
        ? `文件必须小于 ${Math.floor(limit / 1024 / 1024)}MB`
        : `文件过大，最大 ${Math.floor(limit / 1024 / 1024)}MB`
    return c.json({ error: { message, code: 'too_large' } }, 400)
  }
  if (file.size === 0) {
    return c.json({ error: { message: '文件为空', code: 'empty' } }, 400)
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const id = newId()
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
