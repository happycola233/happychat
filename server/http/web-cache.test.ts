import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from './types'
import { isVersionedAssetPath, productionWebCacheMiddleware } from './web-cache'

function createWebCacheTestApp() {
  const app = new Hono<AppEnv>()
  // 与生产注册顺序一致：成功的 API 路由在 Web 缓存中间件之前结束请求。
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.use('/*', productionWebCacheMiddleware)
  app.get('/', (c) => c.html('<!doctype html><title>HappyChat</title>'))
  app.get('/assets/index-content-hash.js', (c) =>
    c.body('console.log("current")', 200, { 'Content-Type': 'text/javascript' }),
  )
  app.get('/assets/range-content-hash.js', (c) =>
    c.body('partial', 206, { 'Content-Type': 'text/javascript' }),
  )
  app.get('/assets/not-modified-content-hash.js', (c) => c.body(null, 304))
  app.get('/favicon.ico', (c) => c.body('icon', 200, { 'Content-Type': 'image/x-icon' }))
  app.notFound((c) => {
    if (isVersionedAssetPath(c.req.path)) return c.body(null, 404)
    return c.html('<!doctype html><title>HappyChat</title>')
  })
  return app
}

describe('productionWebCacheMiddleware', () => {
  it.each(['/', '/login', '/c/conversation-id', '/admin/models'])(
    'forces HTML response revalidation for %s',
    async (path) => {
      const response = await createWebCacheTestApp().request(path)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('text/html')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
    },
  )

  it('caches successful versioned assets for one year as immutable', async () => {
    const response = await createWebCacheTestApp().request('/assets/index-content-hash.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })

  it.each([
    [206, '/assets/range-content-hash.js'],
    [304, '/assets/not-modified-content-hash.js'],
  ])('keeps asset status %i immutable for %s', async (expectedStatus, path) => {
    const response = await createWebCacheTestApp().request(path)

    expect(response.status).toBe(expectedStatus)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })

  it('preserves immutable headers for HEAD asset requests', async () => {
    const response = await createWebCacheTestApp().request('/assets/index-content-hash.js', {
      method: 'HEAD',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(await response.text()).toBe('')
  })

  it('does not cache missing versioned assets as immutable', async () => {
    const response = await createWebCacheTestApp().request('/assets/deleted-build.js')

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type') ?? '').not.toContain('text/html')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
  })

  it('keeps fixed-URL static files revalidatable', async () => {
    const response = await createWebCacheTestApp().request('/favicon.ico')

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
  })

  it('does not add Web cache headers to an earlier successful API route', async () => {
    const response = await createWebCacheTestApp().request('/api/health')

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBeNull()
  })
})

describe('isVersionedAssetPath', () => {
  it('only accepts the Vite asset directory boundary', () => {
    expect(isVersionedAssetPath('/assets/index-hash.js')).toBe(true)
    expect(isVersionedAssetPath('/assets/')).toBe(true)
    expect(isVersionedAssetPath('/assets-old/index.js')).toBe(false)
    expect(isVersionedAssetPath('/api/assets/index.js')).toBe(false)
  })
})
