import { and, eq, inArray } from 'drizzle-orm'
import type { ImageGenerationDetails, ImageOptions } from '@shared/types/domain'
import { db } from '../db/client'
import { attachments, runEvents } from '../db/schema'
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

const FORMAT_BY_OUTPUT: Record<string, { mime: string; ext: string }> = {
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
  gif: { mime: 'image/gif', ext: 'gif' },
  svg: { mime: 'image/svg+xml', ext: 'svg' },
}

function imageFormatFromBuffer(
  buf: Buffer,
  outputFormat?: string | null,
): { mime: string; ext: string } {
  const declared = FORMAT_BY_OUTPUT[outputFormat?.trim().toLowerCase() ?? '']
  if (declared) return declared

  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return FORMAT_BY_OUTPUT.png!
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return FORMAT_BY_OUTPUT.jpeg!
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return FORMAT_BY_OUTPUT.webp!
  }
  if (buf.length >= 6 && buf.toString('ascii', 0, 4) === 'GIF8') return FORMAT_BY_OUTPUT.gif!
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buf.toString('utf8', 0, 256))) {
    return FORMAT_BY_OUTPUT.svg!
  }
  return FORMAT_BY_OUTPUT.png!
}

/** 将上游返回的 base64 生图保存为本站 attachment，并返回轻量引用。 */
export function storeGeneratedImageAttachment(args: StoreGeneratedImageArgs): StoredGeneratedImage {
  const buf = Buffer.from(cleanBase64(args.b64Json), 'base64')
  if (buf.length === 0) throw new Error('上游返回的图片数据为空')

  const format = imageFormatFromBuffer(buf, args.outputFormat)
  const id = newId()
  const prefix = args.filenamePrefix?.trim() || 'generated'
  const filename = `${prefix}.${format.ext}`
  const storagePath = saveUpload(args.userId, id, filename, format.mime, buf)

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

/** 删除临时预览或被整次重新生成取代的图片；当前保留的最终图不走这里。 */
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

/**
 * 最终图已落盘（或整次结果作废）后清理渐进预览：事件里的附件引用改为已删除标记，
 * 回放时不再请求已删除的文件；再删除附件行与磁盘文件。
 */
export function discardPartialImages(runId: string, attachmentIds: ReadonlySet<string>): void {
  if (!attachmentIds.size) return
  const rows = db
    .select({ id: runEvents.id, data: runEvents.data })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, 'image.generation.partial')))
    .all()
  for (const row of rows) {
    if (!attachmentIds.has(String(row.data.attachmentId))) continue
    db.update(runEvents)
      .set({ data: { ...row.data, attachmentId: null, attachmentDeleted: true } })
      .where(eq(runEvents.id, row.id))
      .run()
  }
  removeGeneratedImageAttachments([...attachmentIds])
}

const DETAIL_REQUEST_KEYS = [
  'size',
  'quality',
  'output_format',
  'output_compression',
  'background',
  'moderation',
  'partial_images',
  'n',
  'complexity',
  'frame_count',
  'frame_duration_ms',
] as const
const DETAIL_RESULT_KEYS = ['size', 'quality', 'background', 'output_format'] as const

function pickImageOptions<K extends keyof ImageOptions>(
  source: Record<string, unknown>,
  keys: readonly K[],
): Pick<ImageOptions, K> {
  const picked: Partial<Record<K, unknown>> = {}
  for (const key of keys) {
    const value = source[key]
    if ((typeof value === 'string' && value.length > 0) || typeof value === 'number')
      picked[key] = value
  }
  return picked as Pick<ImageOptions, K>
}

/**
 * 生成详情快照：request 取实际发送的请求体（Images API）或生图工具配置（Responses），
 * result 取上游回显；只保留已知的生图字段，不复制提示词与图片数据。
 */
export function describeImageGeneration(args: {
  request: Record<string, unknown>
  result: Record<string, unknown>
  operation?: ImageGenerationDetails['operation']
  inputImageCount?: number
  startedAt: number | null
}): ImageGenerationDetails {
  return {
    ...(args.operation ? { operation: args.operation } : {}),
    ...(args.inputImageCount ? { inputImageCount: args.inputImageCount } : {}),
    request: pickImageOptions(args.request, DETAIL_REQUEST_KEYS),
    result: pickImageOptions(args.result, DETAIL_RESULT_KEYS),
    durationMs: args.startedAt === null ? null : Math.max(0, Date.now() - args.startedAt),
  }
}
