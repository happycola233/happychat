import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { LOBE_ICON_SLUG_PATTERN } from '@shared/util/modelIcon'
import { requireUser } from '../auth/middleware'
import { db } from '../db/client'
import { modelIcons } from '../db/schema'
import type { AppEnv } from '../http/types'
import {
  getLobeIconCatalog,
  lobeIconAssetVersion,
  readLobeIcon,
  renderLobeIconForTheme,
  type LobeIconTheme,
} from '../services/lobe-icons'
import { mimeFromPath, readUpload } from '../storage/files'

/**
 * 模型 / 分组图标的读取端点。
 *
 * 需要登录（图标出现在聊天界面与管理端，不像头像那样要供公开分享页复用）。
 * 内置图标是随包发布的静态资源，用内容不可变的长缓存；自定义图标按 id 读上传目录。
 */
export const modelIconRoutes = new Hono<AppEnv>()

modelIconRoutes.use('*', requireUser)

/** 内置图标目录：供管理端图标选择器搜索。ETag 取包版本，升级依赖时自然失效。 */
modelIconRoutes.get('/catalog', (c) => {
  const etag = `"lobe-icons-${lobeIconAssetVersion}"`
  c.header('ETag', etag)
  // 目录提供后续 SVG URL 的版本号，页面重载时必须先确认它仍是最新；会话内由 Query cache 去重。
  c.header('Cache-Control', 'no-cache')
  if (c.req.header('if-none-match') === etag) return c.body(null, 304)
  return c.json({ version: lobeIconAssetVersion, icons: getLobeIconCatalog() })
})

modelIconRoutes.get('/lobe/:slug', (c) => {
  const slug = c.req.param('slug').replace(/\.svg$/, '')
  // 先按字符集拒绝，再按白名单集合判定；slug 永远不参与路径拼接之外的任何解释。
  if (!LOBE_ICON_SLUG_PATTERN.test(slug)) {
    return c.json({ error: { message: '图标不存在', code: 'not_found' } }, 404)
  }
  const svg = readLobeIcon(slug)
  if (svg === null) {
    return c.json({ error: { message: '图标不存在', code: 'not_found' } }, 404)
  }
  const requestedTheme = c.req.query('theme')
  if (requestedTheme !== undefined && requestedTheme !== 'light' && requestedTheme !== 'dark') {
    return c.json({ error: { message: '图标主题不合法', code: 'invalid_theme' } }, 400)
  }
  const theme: LobeIconTheme = requestedTheme ?? 'light'
  const etag = `"lobe-${lobeIconAssetVersion}-${theme}-${slug}"`
  c.header('ETag', etag)
  // 只有 URL 显式携带当前目录版本时字节才真正不可变；首帧无版本或旧版本请求必须重验证。
  c.header(
    'Cache-Control',
    c.req.query('v') === lobeIconAssetVersion
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  )
  if (c.req.header('if-none-match') === etag) return c.body(null, 304)
  c.header('Content-Type', 'image/svg+xml; charset=utf-8')
  // 图标可能被当作 <img> 加载：显式禁止嗅探，并禁掉 SVG 内联脚本的执行环境。
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  return c.body(renderLobeIconForTheme(svg, theme))
})

modelIconRoutes.get('/custom/:id', async (c) => {
  const [icon] = await db
    .select()
    .from(modelIcons)
    .where(eq(modelIcons.id, c.req.param('id')))
    .limit(1)
  if (!icon) {
    return c.json({ error: { message: '图标不存在', code: 'not_found' } }, 404)
  }
  try {
    const buf = readUpload(icon.storagePath)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': icon.mime || mimeFromPath(icon.storagePath),
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    })
  } catch {
    return c.json({ error: { message: '图标文件缺失', code: 'file_missing' } }, 404)
  }
})
