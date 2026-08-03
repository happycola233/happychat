import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { LobeIconEntry } from '@shared/types/api'
import { LOBE_ICON_SLUG_PATTERN } from '@shared/util/modelIcon'

export type LobeIconTheme = 'light' | 'dark'

const THEME_FOREGROUND: Record<LobeIconTheme, string> = {
  light: '#171717',
  dark: '#f5f5f5',
}

const PAINT_PROPERTIES = new Set([
  'color',
  'fill',
  'flood-color',
  'lighting-color',
  'stop-color',
  'stroke',
])

function isCurrentColorCompatiblePaint(value: string): boolean {
  return ['currentcolor', 'inherit', 'none', 'transparent'].includes(value.trim().toLowerCase())
}

/** 只有全部可见颜色都来自 currentColor 的 SVG 才能安全降成 CSS mask。 */
export function isPureCurrentColorIcon(svg: string): boolean {
  if (!/\bcurrentColor\b/i.test(svg)) return false
  if (/<(?:linearGradient|radialGradient|style)\b/i.test(svg)) return false

  const paintAttribute = /\b(?:color|fill|flood-color|lighting-color|stop-color|stroke)\s*=\s*(["'])(.*?)\1/gi
  for (const match of svg.matchAll(paintAttribute)) {
    if (!isCurrentColorCompatiblePaint(match[2] ?? '')) return false
  }

  const styleAttribute = /\bstyle\s*=\s*(["'])(.*?)\1/gi
  for (const match of svg.matchAll(styleAttribute)) {
    for (const declaration of (match[2] ?? '').split(';')) {
      const separator = declaration.indexOf(':')
      if (separator === -1) continue
      const property = declaration.slice(0, separator).trim().toLowerCase()
      if (
        PAINT_PROPERTIES.has(property) &&
        !isCurrentColorCompatiblePaint(declaration.slice(separator + 1))
      ) {
        return false
      }
    }
  }
  return true
}

/** 把主题相关的 currentColor 固化为 SVG 自身颜色；固定品牌色与渐变保持原样。 */
export function renderLobeIconForTheme(svg: string, theme: LobeIconTheme): string {
  return svg.replace(/\bcurrentColor\b/gi, THEME_FOREGROUND[theme])
}

/**
 * 自托管 @lobehub/icons-static-svg（AI 品牌图标，MIT）。
 *
 * 与 `routes/emoji-data.ts` 自托管 Emojibase 同一套思路：从 node_modules 读，同源提供，
 * 不依赖公网 CDN（内网/离线部署也不会裂图），前端只发 <img>/CSS mask 请求，打包体积零增长。
 */
const require = createRequire(import.meta.url)

const packageJsonPath = require.resolve('@lobehub/icons-static-svg/package.json')
const iconsDir = join(dirname(packageJsonPath), 'icons')

const lobeIconsVersion: string = (
  require('@lobehub/icons-static-svg/package.json') as { version: string }
).version

/** SVG 字节或 mono 判定算法变化时递增，确保 immutable URL 与目录 ETag 同步换代。 */
const LOBE_ICON_ASSET_REVISION = 1
export const lobeIconAssetVersion = `${lobeIconsVersion}-r${LOBE_ICON_ASSET_REVISION}`

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
 * mono 表示 SVG 的全部可见 paint 都可安全降成 CSS mask；混合 fixed color/currentColor 的图标
 * 会保留彩色渲染，并由详情路由按浅色/深色主题固化其中的 currentColor。
 * 判定需要读全部 903 个文件（约 2.3MB），因此**惰性构建**：首次请求目录时才扫，不拖慢启动。
 */
let catalogCache: LobeIconEntry[] | null = null

export function getLobeIconCatalog(): LobeIconEntry[] {
  if (catalogCache) return catalogCache
  const entries: LobeIconEntry[] = []
  for (const slug of slugSet) {
    const svg = readLobeIcon(slug)
    entries.push({ slug, mono: svg !== null && isPureCurrentColorIcon(svg) })
  }
  entries.sort((left, right) => left.slug.localeCompare(right.slug))
  catalogCache = entries
  return entries
}
