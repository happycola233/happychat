import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { MAX_ANNOUNCEMENT_IMAGE_BYTES } from '@shared/schemas/announcement-image'
import { requireAdmin, requireUser } from '../auth/middleware'
import type { AppEnv } from '../http/types'
import {
  AnnouncementImageUploadError,
  getVisibleAnnouncementImage,
  uploadAnnouncementImage,
} from '../services/announcement-images'
import { readUpload } from '../storage/files'

export const adminAnnouncementImageRoutes = new Hono<AppEnv>()
adminAnnouncementImageRoutes.use('*', requireAdmin)
adminAnnouncementImageRoutes.post(
  '/',
  bodyLimit({
    maxSize: MAX_ANNOUNCEMENT_IMAGE_BYTES + 64 * 1024,
    onError: (c) =>
      c.json({ error: { code: 'file_too_large', message: '请选择不超过 15 MB 的图片' } }, 413),
  }),
  async (c) => {
    const form = await c.req.parseBody()
    const file = form.file
    if (!(file instanceof File))
      return c.json({ error: { code: 'file_required', message: '请选择图片' } }, 400)
    try {
      return c.json({ image: await uploadAnnouncementImage(file) }, 201)
    } catch (error) {
      if (error instanceof AnnouncementImageUploadError)
        return c.json({ error: { code: 'invalid_image', message: error.message } }, 400)
      throw error
    }
  },
)

export const announcementImageRoutes = new Hono<AppEnv>()
announcementImageRoutes.use('*', requireUser)
announcementImageRoutes.get('/:id', (c) => {
  // 每次重核受众及排期，避免退回草稿或收窄受众后沿用浏览器缓存。
  c.header('Cache-Control', 'private, no-store')
  const image = getVisibleAnnouncementImage(c.req.param('id'), c.get('user'))
  if (!image)
    return c.json({ error: { code: 'not_found', message: '图片不存在或当前不可见' } }, 404)
  try {
    return c.body(new Uint8Array(readUpload(image.storagePath)), 200, {
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
  } catch {
    return c.json({ error: { code: 'file_missing', message: '图片文件缺失，请联系管理员' } }, 404)
  }
})
