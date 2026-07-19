import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './types'

const REVALIDATE_CACHE_CONTROL = 'no-cache'
const VERSIONED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const VERSIONED_ASSET_PATH_PREFIX = '/assets/'
const CACHEABLE_ASSET_STATUSES = new Set([200, 206, 304])

/** Vite 构建产物都位于 /assets/，文件名自带内容哈希。 */
export function isVersionedAssetPath(path: string): boolean {
  return path.startsWith(VERSIONED_ASSET_PATH_PREFIX)
}

/**
 * 为最终 Web 响应设置缓存策略：
 * - HTML 每次使用前必须向服务器确认，避免旧入口继续引用旧构建；
 * - 成功返回的哈希资源可永久缓存，内容变化时 Vite 会生成新 URL；
 * - 固定 URL 和错误响应保持可重新验证，避免长期缓存 404 等异常结果。
 *
 * 必须在 await next() 之后读取最终 Content-Type。SPA 回退与静态 index.html
 * 来自不同处理路径，仅凭请求 URL 无法可靠区分二者。
 */
export const productionWebCacheMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()

  const responseContentType = c.res.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (responseContentType.startsWith('text/html')) {
    c.res.headers.set('Cache-Control', REVALIDATE_CACHE_CONTROL)
    return
  }

  const isSuccessfulVersionedAsset =
    isVersionedAssetPath(c.req.path) && CACHEABLE_ASSET_STATUSES.has(c.res.status)

  c.res.headers.set(
    'Cache-Control',
    isSuccessfulVersionedAsset ? VERSIONED_ASSET_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL,
  )
}
