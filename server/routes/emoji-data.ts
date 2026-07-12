import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Hono } from 'hono'

/**
 * 自托管 Emojibase 数据（供前端 frimousse Emoji 选择器使用）。
 * frimousse 默认从 jsdelivr CDN 拉数据，公网 CDN 的可达性/冷启动延迟不可控，
 * 这里改为同源提供：`${emojibaseUrl}/{locale}/{data|messages}.json`。
 * 数据是公开静态资源，无需登录（与头像公开读同理）；ETag 取包版本，
 * frimousse 会用它做 HEAD 校验实现 localStorage 缓存命中。
 */
const require = createRequire(import.meta.url)

const SUPPORTED_LOCALES = new Set(['zh', 'en'])
const SUPPORTED_FILES = new Set(['data.json', 'messages.json'])

const emojibaseVersion: string = (require('emojibase-data/package.json') as { version: string })
  .version

/** 进程内缓存：两份 JSON 合计 <1MB，避免每次请求读盘。 */
const fileCache = new Map<string, string>()

function loadEmojiFile(locale: string, file: string): string {
  const key = `${locale}/${file}`
  let cached = fileCache.get(key)
  if (!cached) {
    cached = readFileSync(require.resolve(`emojibase-data/${key}`), 'utf8')
    fileCache.set(key, cached)
  }
  return cached
}

export const emojiDataRoutes = new Hono()

emojiDataRoutes.get('/:locale/:file', (c) => {
  const { locale, file } = c.req.param()
  if (!SUPPORTED_LOCALES.has(locale) || !SUPPORTED_FILES.has(file)) {
    return c.json({ error: { message: '资源不存在', code: 'not_found' } }, 404)
  }
  const etag = `"emojibase-${emojibaseVersion}-${locale}-${file}"`
  c.header('ETag', etag)
  c.header('Cache-Control', 'public, max-age=86400')
  if (c.req.header('if-none-match') === etag) return c.body(null, 304)
  c.header('Content-Type', 'application/json; charset=utf-8')
  return c.body(loadEmojiFile(locale, file))
})
