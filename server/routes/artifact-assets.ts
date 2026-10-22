import { Hono } from 'hono'
import { artifactAssetByFileName } from '@shared/util/artifactLibraries'
import type { AppEnv } from '../http/types'
import { readArtifactAsset, readArtifactAssetGzip } from '../services/artifact-assets'

/**
 * Artifact 沙箱用到的前端库。公开读：分享页的匿名访客同样需要渲染 Artifact。
 * 文件名带版本号、内容不可变，可长期缓存；只认注册表中的文件名，参数不参与路径拼接。
 */
export const artifactAssetRoutes = new Hono<AppEnv>()

artifactAssetRoutes.get('/:file', (c) => {
  const asset = artifactAssetByFileName(c.req.param('file'))
  if (!asset) return c.json({ error: { message: '资源不存在', code: 'not_found' } }, 404)

  c.header(
    'Content-Type',
    asset.kind === 'script' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
  )
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Vary', 'Accept-Encoding')
  if (/\bgzip\b/i.test(c.req.header('accept-encoding') ?? '')) {
    c.header('Content-Encoding', 'gzip')
    return c.body(readArtifactAssetGzip(asset.id))
  }
  return c.body(readArtifactAsset(asset.id))
})
