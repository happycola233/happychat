import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { isImageMime, isOfficePdfSource, uploadMime } from '@shared/util/fileTypes'
import { db } from '../db/client'
import { attachments } from '../db/schema'
import { requireUser } from '../auth/middleware'
import { newId } from '../lib/id'
import { readUpload, removeUploadStrict, saveUpload, sha256 } from '../storage/files'
import type { AppEnv } from '../http/types'
import { attachmentSecurityHeaders } from '../http/attachment-headers'
import { getUserSettings } from '../services/settings'
import { compressChatImage } from '../services/image-compression'
import { convertAttachmentToPdfInBackground } from '../services/attachment-pdf-conversion'

export const attachmentRoutes = new Hono<AppEnv>()

attachmentRoutes.use('*', requireUser)

/** 按账户偏好决定本次上传的可选转换：图片压缩为 WebP，Word / PowerPoint 转为 PDF。 */
async function uploadConversions(
  userId: string,
  mime: string,
): Promise<{ compressImage: boolean; convertToPdf: boolean }> {
  const isImage = isImageMime(mime)
  // 其他文件无需转换，也就不必读取偏好。
  if (!isImage && !isOfficePdfSource(mime)) return { compressImage: false, convertToPdf: false }
  const { preferences } = await getUserSettings(userId)
  return {
    compressImage: isImage && preferences.compressUploadedImages,
    convertToPdf: !isImage && preferences.convertOfficeToPdf,
  }
}

attachmentRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    return c.json({ error: { message: '未收到文件', code: 'no_file' } }, 400)
  }

  const originalFilename = file.name || 'file'
  const originalMime = uploadMime(originalFilename, file.type)
  if (!originalMime) {
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

  const kind = isImageMime(originalMime) ? 'image' : 'file'
  if (file.size === 0) {
    return c.json({ error: { message: '文件为空', code: 'empty' } }, 400)
  }

  const original = {
    buffer: Buffer.from(await file.arrayBuffer()),
    filename: originalFilename,
    mime: originalMime,
  }
  const { compressImage, convertToPdf } = await uploadConversions(user.id, originalMime)
  // 图片压缩很快，在请求内完成；文档转 PDF 可能要数十秒，先保存原文件，落库后再在后台转换，
  // 用户无需等待即可发送（发送时由 prepareRun 等待转换结束）。
  const { buffer, filename, mime } = compressImage ? await compressChatImage(original) : original
  const id = newId()
  const storagePath = saveUpload(user.id, id, filename, mime, buffer)

  try {
    await db.insert(attachments).values({
      id,
      userId: user.id,
      kind,
      mime,
      filename,
      byteSize: buffer.length,
      storagePath,
      sha256: sha256(buffer),
    })
  } catch (error) {
    // 文件已先落盘；DB 写入失败时立即回滚，避免产生清理任务无法发现的裸磁盘文件。
    try {
      removeUploadStrict(storagePath)
    } catch (rollbackError) {
      // 保留原始 DB 错误，同时留下足够信息供运维定位极少见的二次回滚失败。
      console.error(`附件上传回滚文件失败（attachmentId=${id}）：`, rollbackError)
    }
    throw error
  }

  if (convertToPdf)
    convertAttachmentToPdfInBackground({ id, userId: user.id, storagePath }, original)
  return c.json({ attachment: { id, kind, mime, filename, byteSize: buffer.length } })
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
        ...attachmentSecurityHeaders(a.mime),
      },
    })
  } catch {
    return c.json({ error: { message: '附件文件缺失', code: 'file_missing' } }, 404)
  }
})
