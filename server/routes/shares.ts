import { Hono } from 'hono'
import { getPublicShare, getShareAttachment } from '../services/shares'
import { readUpload } from '../storage/files'
import type { AppEnv } from '../http/types'

/** 公开分享路由（无需登录）。 */
export const shareRoutes = new Hono<AppEnv>()

shareRoutes.get('/:token', async (c) => {
  const share = await getPublicShare(c.req.param('token'))
  if (!share) return c.json({ error: { message: '分享不存在或已失效', code: 'not_found' } }, 404)
  return c.json({ share })
})

shareRoutes.get('/:token/attachments/:id', async (c) => {
  const a = await getShareAttachment(c.req.param('token'), c.req.param('id'))
  if (!a) return c.json({ error: { message: '附件不存在', code: 'not_found' } }, 404)
  try {
    const buf = readUpload(a.storagePath)
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': a.mime, 'Cache-Control': 'public, max-age=86400' },
    })
  } catch {
    return c.json({ error: { message: '附件文件缺失', code: 'file_missing' } }, 404)
  }
})
