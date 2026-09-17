import { z } from 'zod'

export const MAX_ANNOUNCEMENT_IMAGE_BYTES = 15 * 1024 * 1024
export const ANNOUNCEMENT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const ANNOUNCEMENT_IMAGE_DEFAULT_WIDTH = 736

export const announcementImageCropSchema = z
  .object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().positive().max(100),
    height: z.number().positive().max(100),
  })
  .refine((crop) => crop.x + crop.width <= 100.01 && crop.y + crop.height <= 100.01)

export type AnnouncementImageCrop = z.infer<typeof announcementImageCropSchema>

export interface AnnouncementImageLayout {
  src: string
  alt: string
  width: number
  height?: number
  crop?: AnnouncementImageCrop
}

export interface AnnouncementImageDTO {
  id: string
  url: string
  width: number
  height: number
  byteSize: number
}

export const announcementImageUrl = (id: string) => `/api/announcements/images/${id}`

export function announcementImageId(src: string): string | null {
  return (
    /^\/api\/announcements\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#].*)?$/i.exec(
      src,
    )?.[1] ?? null
  )
}

export function parseAnnouncementImageCrop(value: unknown): AnnouncementImageCrop | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value.split(',').map(Number)
  if (parts.length !== 4) return undefined
  const [x, y, width, height] = parts
  const result = announcementImageCropSchema.safeParse({ x, y, width, height })
  return result.success ? result.data : undefined
}

export function announcementImageDimension(value: unknown): number | undefined {
  const size = Number(value)
  return Number.isFinite(size) && size >= 1 && size <= 16000 ? size : undefined
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ')
}

/** 用安全 HTML 保存展示参数，正文仍可直接编辑；百分比裁剪始终引用原图。 */
export function announcementImageMarkup(image: AnnouncementImageLayout): string {
  const crop = image.crop
  const cropAttribute = crop
    ? ` data-crop="${[crop.x, crop.y, crop.width, crop.height].map((value) => Number(value.toFixed(5))).join(',')}"`
    : ''
  return `<img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt)}" width="${Math.round(image.width)}"${image.height ? ` height="${Math.round(image.height)}"` : ''}${cropAttribute}>`
}
