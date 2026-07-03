import { inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { attachments } from '../db/schema'
import { newId } from '../lib/id'
import { removeUpload, saveUpload, sha256 } from '../storage/files'

export interface StoredGeneratedImage {
  attachmentId: string
  mime: string
  filename: string
  byteSize: number
  storagePath: string
}

interface StoreGeneratedImageArgs {
  userId: string
  messageId: string
  b64Json: string
  filenamePrefix?: string
  outputFormat?: string | null
}

function cleanBase64(value: string): string {
  const comma = value.indexOf(',')
  if (value.startsWith('data:') && comma !== -1) return value.slice(comma + 1).replace(/\s/g, '')
  return value.replace(/\s/g, '')
}

function imageFormatFromBuffer(buf: Buffer, outputFormat?: string | null): { mime: string; ext: string } {
  const normalized = outputFormat?.trim().toLowerCase()
  if (normalized === 'jpeg' || normalized === 'jpg') return { mime: 'image/jpeg', ext: 'jpg' }
  if (normalized === 'webp') return { mime: 'image/webp', ext: 'webp' }
  if (normalized === 'png') return { mime: 'image/png', ext: 'png' }

  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  return { mime: 'image/png', ext: 'png' }
}

/** 将上游返回的 base64 生图保存为本站 attachment，并返回轻量引用。 */
export function storeGeneratedImageAttachment(args: StoreGeneratedImageArgs): StoredGeneratedImage {
  const buf = Buffer.from(cleanBase64(args.b64Json), 'base64')
  if (buf.length === 0) throw new Error('上游返回的图片数据为空')

  const format = imageFormatFromBuffer(buf, args.outputFormat)
  const id = newId()
  const prefix = args.filenamePrefix?.trim() || 'generated'
  const filename = `${prefix}.${format.ext}`
  const storagePath = saveUpload(id, filename, format.mime, buf)

  db.insert(attachments)
    .values({
      id,
      userId: args.userId,
      messageId: args.messageId,
      kind: 'image',
      mime: format.mime,
      filename,
      byteSize: buf.length,
      storagePath,
      sha256: sha256(buf),
    })
    .run()

  return {
    attachmentId: id,
    mime: format.mime,
    filename,
    byteSize: buf.length,
    storagePath,
  }
}

/** 删除生成过程中的临时预览附件。最终图不会走这里。 */
export function removeGeneratedImageAttachments(attachmentIds: string[]): void {
  const uniqueIds = [...new Set(attachmentIds)].filter(Boolean)
  if (!uniqueIds.length) return

  const rows = db
    .select({ id: attachments.id, storagePath: attachments.storagePath })
    .from(attachments)
    .where(inArray(attachments.id, uniqueIds))
    .all()
  if (!rows.length) return

  db.delete(attachments)
    .where(
      inArray(
        attachments.id,
        rows.map((row) => row.id),
      ),
    )
    .run()

  for (const row of rows) {
    removeUpload(row.storagePath)
  }
}
