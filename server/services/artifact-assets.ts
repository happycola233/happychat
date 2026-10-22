import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { ARTIFACT_ASSETS, type ArtifactAssetId } from '@shared/util/artifactLibraries'

/**
 * Artifact 用到的前端库，随应用从 node_modules 自托管（与 Emojibase、lobe-icons 同一思路）：
 * 浏览器经同源接口取文本后内联进沙箱文档，导出 HTML 时由服务端直接内联。
 */
const require = createRequire(import.meta.url)
const cache = new Map<ArtifactAssetId, string>()
const gzipCache = new Map<ArtifactAssetId, Uint8Array<ArrayBuffer>>()

/** 不经包的 exports 字段定位包目录：部分包没有导出 package.json，require.resolve 会拒绝。 */
export function artifactPackageDir(packageName: string): string {
  for (const base of require.resolve.paths(packageName) ?? []) {
    const dir = join(base, packageName)
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  throw new Error(`未安装 Artifact 依赖：${packageName}`)
}

/** KaTeX 样式通过相对路径引用字体；沙箱只允许 data: 字体，因此只保留 woff2 并内联。 */
function inlineKatexFonts(css: string, cssDir: string): string {
  return css.replace(
    /src:url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\)(?:,url\([^)]*\) format\("[^"]*"\))*/g,
    (_, font: string) => {
      const data = readFileSync(join(cssDir, 'fonts', `${font}.woff2`)).toString('base64')
      return `src:url(data:font/woff2;base64,${data}) format("woff2")`
    },
  )
}

export function readArtifactAsset(id: ArtifactAssetId): string {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const { packageName, file } = ARTIFACT_ASSETS[id]
  const path = join(artifactPackageDir(packageName), file)
  const raw = readFileSync(path, 'utf8')
  const text = id === 'katex-css' ? inlineKatexFonts(raw, join(path, '..')) : raw
  cache.set(id, text)
  return text
}

/** 预压缩一次后复用：Plotly 原文近 5MB，逐次压缩会在每个未命中缓存的请求上重复耗费 CPU。 */
export function readArtifactAssetGzip(id: ArtifactAssetId): Uint8Array<ArrayBuffer> {
  let compressed = gzipCache.get(id)
  if (!compressed) {
    compressed = new Uint8Array(gzipSync(readArtifactAsset(id), { level: 9 }))
    gzipCache.set(id, compressed)
  }
  return compressed
}
