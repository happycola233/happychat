import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_CONTENT_SECURITY_POLICY,
  buildArtifactDocument,
  collectArtifactAssets,
} from './artifactDocument'
import type { ArtifactAssetId } from './artifactLibraries'

function fakeAssets(ids: ArtifactAssetId[]): Map<ArtifactAssetId, string> {
  return new Map(ids.map((id) => [id, `/*asset:${id}*/`]))
}

const chartSource = [
  '<title>温度</title>',
  '<canvas id="c"></canvas>',
  '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"></script>',
  '<script>new Chart(document.getElementById("c"), {})</script>',
].join('\n')

describe('artifact document', () => {
  it('puts the restrictive CSP before any script and blocks network, forms and base rewrites', () => {
    const html = buildArtifactDocument({
      source: chartSource,
      assets: fakeAssets(['chartjs']),
      theme: { scheme: 'light' },
    })
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).toContain("default-src 'none'")
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'")
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).toContain("form-action 'none'")
    expect(ARTIFACT_CONTENT_SECURITY_POLICY).toContain("base-uri 'none'")
    const cspAt = html.indexOf('http-equiv="Content-Security-Policy"')
    expect(cspAt).toBeGreaterThan(0)
    expect(cspAt).toBeLessThan(html.indexOf('<script'))
  })

  it('inlines bundled libraries in place of their CDN tags and keeps the model code order', () => {
    const html = buildArtifactDocument({
      source: chartSource,
      assets: fakeAssets(['chartjs']),
      theme: { scheme: 'light' },
    })
    expect(html).not.toContain('cdn.jsdelivr.net')
    const libraryAt = html.indexOf('/*asset:chartjs*/')
    expect(libraryAt).toBeGreaterThan(0)
    expect(libraryAt).toBeLessThan(html.indexOf('new Chart('))
    // 库默认配色在载入后立即换成主题变量。
    expect(html).toContain('C.defaults.color')
  })

  it('expands dependencies: styles go to <head>, required scripts load first, duplicates load once', () => {
    const source = [
      '<script src="https://cdn.jsdelivr.net/npm/katex/dist/contrib/auto-render.min.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.js"></script>',
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css">',
    ].join('\n')
    expect(collectArtifactAssets(source)).toEqual(['katex-css', 'katex', 'katex-auto-render'])
    const html = buildArtifactDocument({
      source,
      assets: fakeAssets(['katex-css', 'katex', 'katex-auto-render']),
      theme: { scheme: 'dark' },
    })
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toContain('/*asset:katex-css*/')
    expect(html.split('/*asset:katex*/')).toHaveLength(2)
    expect(html.indexOf('/*asset:katex*/')).toBeLessThan(
      html.indexOf('/*asset:katex-auto-render*/'),
    )
    expect(html).not.toContain('<link')
  })

  it('leaves unknown external resources in place for the CSP to block', () => {
    const source = '<script src="https://evil.example/x.js"></script>'
    expect(collectArtifactAssets(source)).toEqual([])
    const html = buildArtifactDocument({ source, assets: new Map(), theme: { scheme: 'light' } })
    expect(html).toContain('<script src="https://evil.example/x.js"></script>')
  })

  it('escapes sequences in inlined code that would end the script element early', () => {
    const html = buildArtifactDocument({
      source: chartSource,
      assets: new Map([['chartjs', 'var s = "</script><script>alert(1)</script>"; // <!--']]),
      theme: { scheme: 'light' },
    })
    expect(html).toContain('var s = "<\\/script><script>alert(1)<\\/script>"; // \\x3C!--')
  })

  it('applies the explicit scheme and accent, or follows the system when auto', () => {
    const themedSource = '<div style="color:var(--hc-fg)"></div>'
    const dark = buildArtifactDocument({
      source: themedSource,
      assets: new Map(),
      theme: { scheme: 'dark', accent: '#8952ee' },
    })
    expect(dark).toContain('color-scheme:dark')
    expect(dark).toContain('--hc-accent:#8952ee')
    expect(dark).not.toContain('prefers-color-scheme')
    expect(dark).not.toContain('html{background:#fff}')

    const auto = buildArtifactDocument({
      source: themedSource,
      assets: new Map(),
      theme: { scheme: 'auto' },
    })
    expect(auto).toContain('@media (prefers-color-scheme:dark)')
    expect(auto).toContain('--hc-series-1:#2a78d6')
    expect(auto).toContain('--hc-series-1:#3987e5')
  })

  it.each([
    "getComputedStyle(document.documentElement).getPropertyValue('--hc-fg')",
    'const color = name => style.getPropertyValue("--hc-" + name)',
    'const color = name => style.getPropertyValue(`--hc-${name}`)',
  ])('follows the theme when JavaScript reads theme variables: %s', (script) => {
    const html = buildArtifactDocument({
      source: `<canvas></canvas><script>${script}</script>`,
      assets: new Map(),
      theme: { scheme: 'dark' },
    })
    expect(html).toContain('color-scheme:dark')
    expect(html).not.toContain('html{background:#fff}')
  })

  it('keeps content without theme variables light on a white backing, like an image', () => {
    const svg = '<svg viewBox="0 0 10 10"><path stroke="#000" d="M0 0L10 10"/></svg>'
    for (const scheme of ['dark', 'auto'] as const) {
      const html = buildArtifactDocument({ source: svg, assets: new Map(), theme: { scheme } })
      expect(html).toContain('color-scheme:light')
      expect(html).not.toContain('color-scheme:dark')
      expect(html).toContain('html{background:#fff}')
    }
  })

  it('raises devicePixelRatio before any library or model script only when zooming', () => {
    const options = {
      source: chartSource,
      assets: fakeAssets(['chartjs']),
      theme: { scheme: 'light' } as const,
    }
    const zoomed = buildArtifactDocument({ ...options, pixelRatio: 4.5 })
    const overrideAt = zoomed.indexOf("defineProperty(window,'devicePixelRatio'")
    expect(overrideAt).toBeGreaterThan(0)
    expect(overrideAt).toBeLessThan(zoomed.indexOf('<script>(function(){'))
    expect(overrideAt).toBeLessThan(zoomed.indexOf('/*asset:chartjs*/'))
    expect(zoomed).toContain('return 4.5}')
    expect(buildArtifactDocument(options)).not.toContain('devicePixelRatio')
  })

  it('posts size and error messages to the given host origin only', () => {
    const html = buildArtifactDocument({
      source: '<div></div>',
      assets: new Map(),
      theme: { scheme: 'light' },
      hostOrigin: 'https://chat.example.com',
    })
    expect(html).toContain('var origin="https://chat.example.com"')
  })
})
