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
    const isImage = a.mime.startsWith('image/')
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': a.mime,
        // 图片内联展示；其余类型强制下载，避免任何文件在无鉴权的同源 URL 上被当作页面执行。
        'Content-Disposition': `${isImage ? 'inline' : 'attachment'}; filename="${encodeURIComponent(a.filename)}"`,
        'X-Content-Type-Options': 'nosniff',
        // 撤销/过期/取消勾选后必须立即失效，禁止浏览器与中间缓存续命（fresh cache 不回源验证）。
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return c.json({ error: { message: '附件文件缺失', code: 'file_missing' } }, 404)
  }
})
