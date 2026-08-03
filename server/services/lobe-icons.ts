import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { LobeIconEntry } from '@shared/types/api'
import { LOBE_ICON_SLUG_PATTERN } from '@shared/util/modelIcon'

/**
 * 自托管 @lobehub/icons-static-svg（AI 品牌图标，MIT）。
 *
 * 与 `routes/emoji-data.ts` 自托管 Emojibase 同一套思路：从 node_modules 读，同源提供，
 * 不依赖公网 CDN（内网/离线部署也不会裂图），前端只发 <img>/CSS mask 请求，打包体积零增长。
 */
const require = createRequire(import.meta.url)

const packageJsonPath = require.resolve('@lobehub/icons-static-svg/package.json')
const iconsDir = join(dirname(packageJsonPath), 'icons')

export const lobeIconsVersion: string = (
  require('@lobehub/icons-static-svg/package.json') as { version: string }
).version

/**
 * slug 白名单。启动时只做一次 readdir（便宜），随后所有请求都按集合判定——
 * 任何用户输入都不会参与路径拼接，从根上排除路径穿越。
 */
const slugSet: Set<string> = new Set(
  readdirSync(iconsDir)
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -4))
    .filter((slug) => LOBE_ICON_SLUG_PATTERN.test(slug)),
)

export function isKnownLobeIconSlug(slug: string): boolean {
  return slugSet.has(slug)
}

/** 单个图标的 SVG 源码（进程内缓存；单个约 2.5KB）。 */
const svgCache = new Map<string, string>()

export function readLobeIcon(slug: string): string | null {
  if (!slugSet.has(slug)) return null
  let cached = svgCache.get(slug)
  if (cached === undefined) {
    cached = readFileSync(join(iconsDir, `${slug}.svg`), 'utf8')
    svgCache.set(slug, cached)
  }
  return cached
}

/**
 * 图标目录（含 mono 标记）。
 *
 * mono 表示 SVG 内部使用 `fill="currentColor"`，前端会改用 CSS mask 渲染让它随主题变色——
 * 单色图标若按 <img> 渲染，currentColor 会落回 SVG 自带的黑色，深色模式下直接看不见。
 * 判定需要读全部 903 个文件（约 2.3MB），因此**惰性构建**：首次请求目录时才扫，不拖慢启动。
 */
let catalogCache: LobeIconEntry[] | null = null

export function getLobeIconCatalog(): LobeIconEntry[] {
  if (catalogCache) return catalogCache
  const entries: LobeIconEntry[] = []
  for (const slug of slugSet) {
    const svg = readLobeIcon(slug)
    entries.push({ slug, mono: svg !== null && svg.includes('currentColor') })
  }
  entries.sort((left, right) => left.slug.localeCompare(right.slug))
  catalogCache = entries
  return entries
}
