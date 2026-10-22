import { ARTIFACT_ASSETS, matchArtifactAsset } from './artifactLibraries'
import type { ArtifactAssetId, ArtifactAssetKind } from './artifactLibraries'

/**
 * 把 Artifact 源码（协议约定的 HTML 片段，或模型直接给出的 SVG）包装成可以放进
 * `<iframe sandbox="allow-scripts" srcdoc>` 的完整文档。
 *
 * 安全边界在宿主侧：iframe 不带 allow-same-origin，文档是不透明源，碰不到站点的 DOM、
 * cookie 与存储；这里的 CSP 再切断一切网络请求、表单提交与 <base> 改写，防止把数据带出去。
 * 源码本身不做过滤（也无从过滤），一律按不可信代码对待。
 */

export type ArtifactColorScheme = 'light' | 'dark' | 'auto'

export interface ArtifactTheme {
  /** auto 跟随系统（导出文件、下载的单文件网页）；站内按当前主题显式指定。 */
  scheme: ArtifactColorScheme
  /** 当前重点色；省略时使用默认蓝色。 */
  accent?: string
}

export const ARTIFACT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  // 模型代码与内联库都在页内；部分库（如 JSXGraph 的表达式）需要 eval。沙箱内这不扩大权限。
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * 宿主页面（聊天页、分享页）的 CSP，只约束框架导航：sandbox 与组件内 CSP 都挡不住组件把自身
 * iframe 导航到外部站点（可被用来钓鱼，或把数据拼进 URL 带走），这类导航只受宿主页面 frame-src 约束。
 * srcdoc 不属于网络加载，不受它影响。
 */
export const HOST_FRAME_POLICY = "frame-src 'self'"

/** 聊天、分享与 HTML 导出统一的嵌入高度上限，超过后在 iframe 内滚动。 */
export const ARTIFACT_MAX_FRAME_HEIGHT = 1200

/** 沙箱发给宿主的消息：只有尺寸与错误两种，宿主不会执行或插入其中任何内容。 */
export type ArtifactFrameMessage =
  | { source: 'hc-artifact'; type: 'size'; height: number }
  | { source: 'hc-artifact'; type: 'error'; message: string }

const DEFAULT_ACCENT = { light: '#3a83f7', dark: '#2c67c5' } as const

// 文字与线条取站内中性色阶；系列色是 dataviz 校验过的分类色板（浅/深色分别针对白底与 #171717 卡片底）。
const THEME_TOKENS = {
  light: {
    fg: '#262626',
    muted: '#737373',
    grid: '#e5e5e5',
    border: '#d4d4d4',
    surface: '#f5f5f5',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  },
  dark: {
    fg: '#f5f5f5',
    muted: '#a3a3a3',
    grid: '#2e2e2e',
    border: '#404040',
    surface: '#262626',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'],
  },
} as const

const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

function themeVariables(scheme: 'light' | 'dark', accent: string): string {
  const tokens = THEME_TOKENS[scheme]
  return [
    `color-scheme:${scheme}`,
    `--hc-fg:${tokens.fg}`,
    `--hc-muted:${tokens.muted}`,
    `--hc-grid:${tokens.grid}`,
    `--hc-border:${tokens.border}`,
    `--hc-surface:${tokens.surface}`,
    `--hc-accent:${accent}`,
    ...tokens.series.map((color, index) => `--hc-series-${index + 1}:${color}`),
    `--hc-font:${FONT_STACK}`,
  ].join(';')
}

/**
 * 没用主题变量的内容是按浅色背景设计的（模型常把线条和文字写死成黑色），在深色背景上会看不清。
 * 这类内容固定按浅色渲染，并像图片一样垫一层白底。
 */
export function usesThemeVariables(source: string): boolean {
  // Canvas 等内容会通过 JS 读取主题变量，也可能用辅助函数拼接变量名。
  return /var\(\s*--hc-|['"`]--hc-/.test(source)
}

const PAPER_CSS = 'html{background:#fff}'

function themeCss(theme: ArtifactTheme): string {
  if (theme.scheme === 'auto') {
    return (
      `:root{${themeVariables('light', theme.accent ?? DEFAULT_ACCENT.light)}}` +
      `@media (prefers-color-scheme:dark){:root{${themeVariables('dark', theme.accent ?? DEFAULT_ACCENT.dark)}}}`
    )
  }
  return `:root{${themeVariables(theme.scheme, theme.accent ?? DEFAULT_ACCENT[theme.scheme])}}`
}

// 放在库样式之后：给模型没写样式的控件一个与站内一致的外观，并压掉 JSXGraph 自带的白底蓝框。
const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;background:transparent}
html{scrollbar-width:thin;scrollbar-color:var(--hc-border) transparent}
html::-webkit-scrollbar{width:10px;height:10px}
html::-webkit-scrollbar-track{background:transparent}
html::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:999px;background:var(--hc-muted);background-clip:padding-box}
html::-webkit-scrollbar-corner,html::-webkit-scrollbar-button{display:none}
@supports selector(::-webkit-scrollbar){html{scrollbar-width:auto;scrollbar-color:auto}}
body{padding:16px;color:var(--hc-fg);font:14px/1.5 var(--hc-font);-webkit-font-smoothing:antialiased}
@media (max-width:480px){body{padding:12px}}
h1,h2,h3,h4{margin:0 0 8px;font-size:15px;font-weight:600}
p{margin:0 0 8px}
canvas,svg,img,video{max-width:100%}
svg,img{height:auto}
button,input,select,textarea{font:inherit;color:inherit;accent-color:var(--hc-accent)}
button{padding:4px 12px;border:1px solid var(--hc-border);border-radius:8px;background:var(--hc-surface);cursor:pointer}
button:hover{border-color:var(--hc-muted)}
input:not([type=range]):not([type=checkbox]):not([type=radio]),select,textarea{padding:4px 8px;border:1px solid var(--hc-border);border-radius:8px;background:transparent}
:focus-visible{outline:2px solid var(--hc-accent);outline-offset:2px}
.jxgbox{background-color:transparent;border-color:var(--hc-border)}`

// 库默认配色按白底设计：载入后立即把默认值换成主题变量，模型没指定颜色时深色模式也清晰可读。
// 模型显式传入的颜色仍然优先。
const THEME_ADAPTERS: Partial<Record<ArtifactAssetId, string>> = {
  chartjs: `(function(){var C=window.Chart;if(!C)return;var s=getComputedStyle(document.documentElement);var v=function(n){return s.getPropertyValue(n).trim()};C.defaults.color=v('--hc-muted');C.defaults.borderColor=v('--hc-grid');C.defaults.font.family=v('--hc-font')})()`,
  jsxgraph: `(function(){var J=window.JXG;if(!J||!J.Options)return;var s=getComputedStyle(document.documentElement);var v=function(n){return s.getPropertyValue(n).trim()};var o=J.Options;o.text.strokeColor=o.text.highlightStrokeColor=v('--hc-fg');o.axis.strokeColor=o.axis.highlightStrokeColor=v('--hc-muted');if(o.axis.ticks)o.axis.ticks.strokeColor=v('--hc-muted');o.ticks.strokeColor=v('--hc-muted');o.grid.strokeColor=v('--hc-grid');o.navbar.strokeColor=v('--hc-muted');o.infobox.strokeColor=v('--hc-fg')})()`,
  plotly: `(function(){var P=window.Plotly;if(!P)return;var s=getComputedStyle(document.documentElement);var v=function(n){return s.getPropertyValue(n).trim()};var axis={gridcolor:v('--hc-grid'),zerolinecolor:v('--hc-border'),linecolor:v('--hc-border')};var axis3d={gridcolor:v('--hc-grid'),zerolinecolor:v('--hc-border'),linecolor:v('--hc-border'),backgroundcolor:'rgba(0,0,0,0)'};var base={paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{color:v('--hc-fg'),family:v('--hc-font')},xaxis:axis,yaxis:axis,scene:{xaxis:axis3d,yaxis:axis3d,zaxis:axis3d}};var plain=function(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)};var merge=function(b,u){if(!plain(u))return u===undefined?b:u;var r=Object.assign({},b);for(var k in u)r[k]=plain(b[k])?merge(b[k],u[k]):u[k];return r};['newPlot','react'].forEach(function(name){var fn=P[name];P[name]=function(gd,data,layout,config){if(plain(data)){var figure=Object.assign({},data,{layout:merge(base,data.layout)});return fn.call(this,gd,figure)}return fn.call(this,gd,data,merge(base,layout),config)}});P.setPlotConfig({displaylogo:false,modeBarButtonsToRemove:['toImage']})})()`,
}

function bridgeScript(hostOrigin: string): string {
  // 先按无竖向滚动条的完整宽度测高，否则响应式 SVG 会缩小并把 iframe 锁在偏小的高度。
  // 只给超过上限的嵌入内容开放竖向滚动；独立下载页仍由浏览器正常滚动。
  // 横向滚动条厚度也计入高度；ResizeObserver 延到下一帧测量，避免修改根布局时触发观察循环。
  return `(function(){
var host=parent===window?null:parent;var origin=${JSON.stringify(hostOrigin)};
function send(message){message.source='hc-artifact';if(host)host.postMessage(message,origin)}
var root=document.documentElement;if(host)root.style.overflowY='hidden';
var lastHeight=-1;
function measure(){
var body=document.body;if(!body||!host)return;
root.style.overflowY='hidden';
var horizontalScrollbarHeight=innerHeight-root.clientHeight;
var height=Math.ceil(Math.max(body.scrollHeight,body.getBoundingClientRect().height)+horizontalScrollbarHeight);
root.style.overflowY=height>${ARTIFACT_MAX_FRAME_HEIGHT}?'auto':'hidden';
if(height!==lastHeight){lastHeight=height;send({type:'size',height:height})}
}
var measureFrame=0;
function scheduleMeasure(){if(!measureFrame)measureFrame=requestAnimationFrame(function(){measureFrame=0;measure()})}
var reported={};var count=0;
function report(text){text=String(text||'').slice(0,500);if(!text||reported[text]||count>=5)return;reported[text]=true;count++;send({type:'error',message:text})}
addEventListener('error',function(event){if(event instanceof ErrorEvent)report(event.message||(event.error&&event.error.message))});
addEventListener('unhandledrejection',function(event){var reason=event.reason;report(reason&&reason.message?reason.message:reason)});
addEventListener('securitypolicyviolation',function(event){report('已阻止访问外部资源：'+(event.blockedURI||event.violatedDirective))});
var observer=new ResizeObserver(scheduleMeasure);
addEventListener('DOMContentLoaded',function(){observer.observe(document.body);observer.observe(document.documentElement);measure()});
addEventListener('load',function(){measure();setTimeout(measure,300);setTimeout(measure,1200)});
})()`
}

/** 内联文本里提前结束元素或切换解析状态的序列需要转义；替换后的写法在 JS 字符串、正则与注释中都等价。 */
function inlineScript(text: string): string {
  return text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--')
}

function inlineStyle(text: string): string {
  return text.replace(/<\/style/gi, '<\\/style')
}

interface ExternalTag {
  start: number
  end: number
  kind: ArtifactAssetKind
  assetId: ArtifactAssetId | null
}

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const LINK_TAG = /<link\b[^>]*>/gi

function attributeValue(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(
    attributes,
  )
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

/** 找出源码里引用外部脚本与样式表的标签（内联脚本不在其中）。 */
function scanExternalTags(source: string): ExternalTag[] {
  const tags: ExternalTag[] = []
  for (const match of source.matchAll(SCRIPT_TAG)) {
    const src = attributeValue(match[1]!, 'src')
    if (src === null || match[2]!.trim()) continue
    tags.push({
      start: match.index!,
      end: match.index! + match[0].length,
      kind: 'script',
      assetId: matchArtifactAsset(src, 'script'),
    })
  }
  for (const match of source.matchAll(LINK_TAG)) {
    const rel = attributeValue(match[0], 'rel')
    const href = attributeValue(match[0], 'href')
    if (!href || !rel?.toLowerCase().split(/\s+/).includes('stylesheet')) continue
    tags.push({
      start: match.index!,
      end: match.index! + match[0].length,
      kind: 'style',
      assetId: matchArtifactAsset(href, 'style'),
    })
  }
  return tags.sort((a, b) => a.start - b.start)
}

/** 依赖展开后的加载顺序：被依赖的资源排在前面。 */
function withRequirements(ids: Iterable<ArtifactAssetId>): ArtifactAssetId[] {
  const ordered: ArtifactAssetId[] = []
  const visit = (id: ArtifactAssetId) => {
    if (ordered.includes(id)) return
    ARTIFACT_ASSETS[id].requires.forEach(visit)
    ordered.push(id)
  }
  for (const id of ids) visit(id)
  return ordered
}

/** 渲染这段源码需要预先读取的全部资源（脚本与样式）。 */
export function collectArtifactAssets(source: string): ArtifactAssetId[] {
  return withRequirements(
    scanExternalTags(source).flatMap((tag) => (tag.assetId ? [tag.assetId] : [])),
  )
}

export interface BuildArtifactDocumentOptions {
  source: string
  /** collectArtifactAssets 列出的全部资源内容。 */
  assets: ReadonlyMap<ArtifactAssetId, string>
  theme: ArtifactTheme
  /** 沙箱向宿主 postMessage 时的目标源；单文件网页没有确定的宿主源，使用 '*'。 */
  hostOrigin?: string
  lang?: string
  /**
   * 覆盖文档内的 devicePixelRatio。放大查看会把整个 iframe 等比放大，
   * 按放大后的像素密度绘制，Canvas 才不会发虚。
   */
  pixelRatio?: number
}

export function buildArtifactDocument({
  source,
  assets,
  theme,
  hostOrigin = '*',
  lang = 'zh-CN',
  pixelRatio,
}: BuildArtifactDocumentOptions): string {
  const styles = new Set<ArtifactAssetId>()
  const inlinedScripts = new Set<ArtifactAssetId>()
  const scriptBlock = (id: ArtifactAssetId): string => {
    let html = ''
    for (const dependency of withRequirements([id])) {
      if (ARTIFACT_ASSETS[dependency].kind === 'style') {
        styles.add(dependency)
        continue
      }
      if (inlinedScripts.has(dependency)) continue
      inlinedScripts.add(dependency)
      html += `<script data-artifact-asset="${dependency}">${inlineScript(assets.get(dependency)!)}</script>`
      const adapter = THEME_ADAPTERS[dependency]
      if (adapter) html += `<script>${adapter}</script>`
    }
    return html
  }

  let body = ''
  let cursor = 0
  for (const tag of scanExternalTags(source)) {
    body += source.slice(cursor, tag.start)
    cursor = tag.end
    if (!tag.assetId) {
      // 无法识别的外链原样保留：CSP 会拦下，桥接脚本把拦截原因报给宿主。
      body += source.slice(tag.start, tag.end)
    } else if (tag.kind === 'script') {
      body += scriptBlock(tag.assetId)
    } else {
      styles.add(tag.assetId)
    }
  }
  body += source.slice(cursor)

  const styleTags = withRequirements(styles)
    .map((id) => `<style data-artifact-asset="${id}">${inlineStyle(assets.get(id)!)}</style>`)
    .join('')
  const themed = usesThemeVariables(source)

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CONTENT_SECURITY_POLICY}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${pixelRatio ? `<script>Object.defineProperty(window,'devicePixelRatio',{configurable:true,get:function(){return ${pixelRatio}}})</script>\n` : ''}<script>${inlineScript(bridgeScript(hostOrigin))}</script>
<style>${themeCss(themed ? theme : { scheme: 'light', accent: theme.accent })}</style>
${styleTags}
<style>${BASE_CSS}${themed ? '' : PAPER_CSS}</style>
</head>
<body>
${body}
</body>
</html>`
}
