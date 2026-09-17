import { and, eq, exists, inArray, lt, notExists } from 'drizzle-orm'
import sharp, { type OutputInfo } from 'sharp'
import {
  MAX_ANNOUNCEMENT_IMAGE_BYTES,
  announcementImageUrl,
  type AnnouncementImageDTO,
} from '@shared/schemas/announcement-image'
import { db } from '../db/client'
import { announcementImages, announcementImageLinks, announcements } from '../db/schema'
import { newId } from '../lib/id'
import { saveUpload, removeUpload, removeUploadStrict, uploadFileExists } from '../storage/files'
import type { AuthUser } from '../http/types'
import { announcementVisibleCondition } from './announcement-visibility'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class AnnouncementImageUploadError extends Error {}

export async function uploadAnnouncementImage(file: File): Promise<AnnouncementImageDTO> {
  if (!file.size || file.size > MAX_ANNOUNCEMENT_IMAGE_BYTES) {
    throw new AnnouncementImageUploadError('请选择不超过 15 MB 的图片')
  }
  let encoded: { data: Buffer; info: OutputInfo }
  try {
    // 真实解码并重新编码，拒绝伪造 MIME/SVG，移除 EXIF 等元数据；动图保留全部帧。
    const image = sharp(Buffer.from(await file.arrayBuffer()), {
      animated: true,
      limitInputPixels: 40_000_000,
    })
    const metadata = await image.metadata()
    if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format ?? '')) throw new Error('format')
    encoded = await image.autoOrient().webp({ quality: 92 }).toBuffer({ resolveWithObject: true })
  } catch {
    throw new AnnouncementImageUploadError(
      '无法读取图片，请选择完整的 PNG、JPEG、WebP 或 GIF 图片（总像素不超过 4,000 万）',
    )
  }
  if (encoded.data.length > MAX_ANNOUNCEMENT_IMAGE_BYTES)
    throw new AnnouncementImageUploadError('图片处理后超过 15 MB，请缩小后重试')
  const id = newId()
  const storagePath = saveUpload('announcements', id, `${id}.webp`, 'image/webp', encoded.data)
  const width = encoded.info.width
  const height = encoded.info.pageHeight ?? encoded.info.height
  try {
    db.insert(announcementImages)
      .values({ id, storagePath, width, height, byteSize: encoded.data.length })
      .run()
  } catch (error) {
    removeUpload(storagePath)
    throw error
  }
  return { id, url: announcementImageUrl(id), width, height, byteSize: encoded.data.length }
}

export function hasMissingAnnouncementImages(tx: Transaction, ids: readonly string[]): boolean {
  if (!ids.length) return false
  const rows = tx.select().from(announcementImages).where(inArray(announcementImages.id, ids)).all()
  return rows.length !== ids.length || rows.some((row) => !uploadFileExists(row.storagePath))
}

/** 与正文保存处于同一事务；复用到多条公告的图片不会被单条删除影响。 */
export function replaceAnnouncementImageLinks(
  tx: Transaction,
  announcementId: string,
  ids: readonly string[],
) {
  tx.delete(announcementImageLinks)
    .where(eq(announcementImageLinks.announcementId, announcementId))
    .run()
  if (ids.length)
    tx.insert(announcementImageLinks)
      .values(ids.map((imageId) => ({ announcementId, imageId })))
      .run()
}

export function getVisibleAnnouncementImage(id: string, user: AuthUser) {
  return db
    .select()
    .from(announcementImages)
    .where(
      and(
        eq(announcementImages.id, id),
        // 管理员需预览未发布/未保存图片；普通用户只能读取至少一条当前可见公告引用的图片。
        user.role === 'admin'
          ? undefined
          : exists(
              db
                .select({ id: announcements.id })
                .from(announcementImageLinks)
                .innerJoin(
                  announcements,
                  eq(announcements.id, announcementImageLinks.announcementId),
                )
                .where(
                  and(
                    eq(announcementImageLinks.imageId, id),
                    announcementVisibleCondition(user, new Date()),
                  ),
                ),
            ),
      ),
    )
    .get()
}

/** 回收上传超过 24 小时且未被任何公告引用的图片；草稿、排期和跨公告复用都受保护。 */
export function cleanupUnusedAnnouncementImages(now = new Date()): number {
  const orphanCondition = and(
    lt(announcementImages.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    notExists(
      db
        .select({ imageId: announcementImageLinks.imageId })
        .from(announcementImageLinks)
        .where(eq(announcementImageLinks.imageId, announcementImages.id)),
    ),
  )
  const rows = db.select().from(announcementImages).where(orphanCondition).all()
  let removed = 0
  for (const row of rows) {
    try {
      db.transaction(
        (tx) => {
          const deleted = tx
            .delete(announcementImages)
            .where(and(eq(announcementImages.id, row.id), orphanCondition))
            .returning()
            .get()
          if (deleted) {
            removeUploadStrict(deleted.storagePath)
            removed += 1
          }
        },
        { behavior: 'immediate' },
      )
    } catch (error) {
      console.error(`公告图片清理失败（${row.id}）：`, error)
    }
  }
  return removed
}
