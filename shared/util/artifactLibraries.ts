/**
 * Artifact 可用的自托管前端库。
 *
 * 模型照习惯写下的 CDN `<script>` / `<link>` 会被识别并替换成站内副本，内联进沙箱文档，
 * 因此沙箱里不需要任何网络访问。版本必须与 package.json 中的精确版本一致（有单测守护）；
 * 系统提示词里展示给模型的地址也由这里生成，提示词、服务端读取与前端替换三处不会漂移。
 */

export type ArtifactAssetKind = 'script' | 'style'

export type ArtifactAssetId =
  | 'jsxgraph'
  | 'jsxgraph-css'
  | 'chartjs'
  | 'plotly'
  | 'd3'
  | 'katex'
  | 'katex-css'
  | 'katex-auto-render'

export interface ArtifactAsset {
  id: ArtifactAssetId
  kind: ArtifactAssetKind
  packageName: string
  version: string
  /** npm 包内的文件路径 */
  file: string
  /** 内联本资源前必须先就位的资源：脚本依赖按顺序插在前面，样式统一放进 <head>。 */
  requires: readonly ArtifactAssetId[]
}

const PACKAGE_VERSIONS = {
  jsxgraph: '1.14.1',
  'chart.js': '4.5.1',
  'plotly.js-dist-min': '4.1.2',
  d3: '7.9.0',
  katex: '0.17.0',
} as const

type ArtifactPackageName = keyof typeof PACKAGE_VERSIONS

function asset(
  id: ArtifactAssetId,
  kind: ArtifactAssetKind,
  packageName: ArtifactPackageName,
  file: string,
  requires: readonly ArtifactAssetId[] = [],
): ArtifactAsset {
  return { id, kind, packageName, version: PACKAGE_VERSIONS[packageName], file, requires }
}

export const ARTIFACT_ASSETS: Readonly<Record<ArtifactAssetId, ArtifactAsset>> = {
  jsxgraph: asset('jsxgraph', 'script', 'jsxgraph', 'distrib/jsxgraphcore.js', ['jsxgraph-css']),
  'jsxgraph-css': asset('jsxgraph-css', 'style', 'jsxgraph', 'distrib/jsxgraph.css'),
  chartjs: asset('chartjs', 'script', 'chart.js', 'dist/chart.umd.min.js'),
  plotly: asset('plotly', 'script', 'plotly.js-dist-min', 'plotly.min.js'),
  d3: asset('d3', 'script', 'd3', 'dist/d3.min.js'),
  katex: asset('katex', 'script', 'katex', 'dist/katex.min.js', ['katex-css']),
  'katex-css': asset('katex-css', 'style', 'katex', 'dist/katex.min.css'),
  'katex-auto-render': asset(
    'katex-auto-render',
    'script',
    'katex',
    'dist/contrib/auto-render.min.js',
    ['katex'],
  ),
}

/** 写进系统提示词的库：顺序即推荐顺序。 */
export const ARTIFACT_PROMPT_LIBRARIES = [
  { assetId: 'jsxgraph', name: 'JSXGraph', global: 'JXG' },
  { assetId: 'chartjs', name: 'Chart.js', global: 'Chart' },
  { assetId: 'plotly', name: 'Plotly', global: 'Plotly' },
  { assetId: 'd3', name: 'D3', global: 'd3' },
  { assetId: 'katex', name: 'KaTeX', global: 'katex' },
] as const satisfies readonly { assetId: ArtifactAssetId; name: string; global: string }[]

/** 提示词里让模型照抄的地址：渲染时会被替换成本地副本，并不真正访问该 CDN。 */
export function artifactAssetCdnUrl(id: ArtifactAssetId): string {
  const { packageName, version, file } = ARTIFACT_ASSETS[id]
  return `https://cdn.jsdelivr.net/npm/${packageName}@${version}/${file}`
}

/** 站内同源地址的文件名：带版本号，可长期缓存。 */
export function artifactAssetFileName(id: ArtifactAssetId): string {
  const { version, kind } = ARTIFACT_ASSETS[id]
  return `${id}-${version}.${kind === 'script' ? 'js' : 'css'}`
}

export function artifactAssetByFileName(fileName: string): ArtifactAsset | null {
  return (
    Object.values(ARTIFACT_ASSETS).find((item) => artifactAssetFileName(item.id) === fileName) ?? null
  )
}

// d3 v7 完整包已包含这些子模块；d3-sankey 等扩展不在包内，不能映射成完整包。
const D3_BUNDLED_MODULES =
  'array|axis|brush|chord|color|contour|delaunay|dispatch|drag|dsv|ease|fetch|force|format|geo|hierarchy|interpolate|path|polygon|quadtree|random|scale|scale-chromatic|selection|shape|time|time-format|timer|transition|zoom'
const D3_URL = new RegExp(
  `(?:^|/)d3(?:-(?:${D3_BUNDLED_MODULES}))?(?:@[^/]*)?(?:/|\\.v\\d|\\.min|\\.js|$)`,
  'i',
)

/** 按顺序匹配：更具体的规则在前（插件、扩展不能误映射成主库）。 */
const SCRIPT_MATCHERS: readonly [RegExp, ArtifactAssetId | null][] = [
  [/katex[^?#]*auto-render/i, 'katex-auto-render'],
  [/katex[^?#]*contrib/i, null],
  [/katex/i, 'katex'],
  [/jsxgraph/i, 'jsxgraph'],
  [/plotly/i, 'plotly'],
  // Chart.js 生态包统一以 chartjs- 命名（插件、适配器、扩展图表类型），核心包名是 chart.js。
  [/chartjs-/i, null],
  [/chart\.js|chart\.umd|\/chart(?:\.min)?\.js/i, 'chartjs'],
  [D3_URL, 'd3'],
]

const STYLE_MATCHERS: readonly [RegExp, ArtifactAssetId][] = [
  [/katex[^?#]*\.css/i, 'katex-css'],
  [/jsxgraph[^?#]*\.css/i, 'jsxgraph-css'],
]

/** 识别模型写下的外链；无法识别时返回 null，交给沙箱 CSP 拦截。 */
export function matchArtifactAsset(url: string, kind: ArtifactAssetKind): ArtifactAssetId | null {
  const matchers = kind === 'script' ? SCRIPT_MATCHERS : STYLE_MATCHERS
  for (const [pattern, id] of matchers) {
    if (pattern.test(url)) return id
  }
  return null
}
