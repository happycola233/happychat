import type { MiddlewareHandler } from 'hono'
import { HOST_FRAME_POLICY } from '@shared/util/artifactDocument'
import type { AppEnv } from './types'

/**
 * 给所有 HTML 页面加上只约束框架导航的 CSP（原因见 HOST_FRAME_POLICY）。
 * 与缓存策略中间件相同，在 await next() 之后按最终 Content-Type 判断，覆盖静态入口与 SPA 回退。
 */
export const hostFramePolicyMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  const contentType = c.res.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (contentType.startsWith('text/html')) {
    c.res.headers.set('Content-Security-Policy', HOST_FRAME_POLICY)
  }
}
