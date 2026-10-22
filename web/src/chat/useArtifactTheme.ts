import { useMemo, useSyncExternalStore } from 'react'
import type { ArtifactTheme } from '@shared/util/artifactDocument'

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/**
 * 主题与重点色都由 <html> 的类切换。默认（灰）重点色与未读圆点一样借用蓝色光晕色调，
 * 灰色当作 Artifact 的强调色既不醒目也难以区分。
 */
function snapshot(): string {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const accent =
    style.getPropertyValue('--hc-accent-glow-tint').trim() ||
    style.getPropertyValue('--hc-accent-swatch').trim()
  return `${root.classList.contains('dark') ? 'dark' : 'light'}|${accent}`
}

/** 静态渲染（单测的 renderToStaticMarkup）没有 DOM，按默认浅色处理。 */
function serverSnapshot(): string {
  return 'light|'
}

/** 沙箱文档使用的主题；只有明暗或重点色真正变化时才返回新对象，避免无谓地重建 iframe。 */
export function useArtifactTheme(): ArtifactTheme {
  const key = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  return useMemo(() => {
    const [scheme, accent] = key.split('|') as ['light' | 'dark', string]
    return { scheme, accent: accent || undefined }
  }, [key])
}
