import type { ContentPart } from '@shared/types/domain'
import { textFromContent } from '@shared/util/contentText'

const DEFAULT_SHARE_TITLE = '分享的对话'
const DEFAULT_SHARE_DESCRIPTION = '来自 HappyChat 的公开对话'
const SHARE_DESCRIPTION_MAX_CHARACTERS = 160
const SHARE_IMAGE_PATH = '/app-icon-512x512.png'

interface SharePreviewMessage {
  role: 'user' | 'assistant' | 'system'
  content: ContentPart[]
}

export interface SharePreviewData {
  title: string | null
  messages: SharePreviewMessage[]
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function firstForwardedValue(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null
}

function truncatePreviewText(value: string): string {
  const characters = Array.from(value)
  if (characters.length <= SHARE_DESCRIPTION_MAX_CHARACTERS) return value
  return `${characters.slice(0, SHARE_DESCRIPTION_MAX_CHARACTERS - 1).join('')}…`
}

/** 只从公开快照取摘要；优先使用第一条有正文的用户消息。 */
export function buildShareDescription(messages: SharePreviewMessage[]): string {
  const message =
    messages.find((item) => item.role === 'user' && textFromContent(item.content).trim()) ??
    messages.find((item) => textFromContent(item.content).trim())
  if (!message) return DEFAULT_SHARE_DESCRIPTION

  const singleLineText = textFromContent(message.content).replace(/\s+/g, ' ').trim()
  return truncatePreviewText(singleLineText)
}

/**
 * 反向代理终止 TLS 时，Node 收到的内部 URL 可能仍是 http；优先采用代理转发的公开协议与域名。
 */
export function resolvePublicRequestUrl(request: Request): URL {
  const url = new URL(request.url)
  const forwardedHost = firstForwardedValue(request.headers.get('x-forwarded-host'))
  const forwardedProtocol = firstForwardedValue(request.headers.get('x-forwarded-proto'))
  const publicProtocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? `${forwardedProtocol}:`
      : url.protocol

  if (forwardedHost) {
    const publicOrigin = new URL(`${publicProtocol}//${forwardedHost}`)
    url.hostname = publicOrigin.hostname
    url.port = publicOrigin.port
  }
  url.protocol = publicProtocol
  url.search = ''
  url.hash = ''
  return url
}

/** 在 Vite 入口 HTML 中注入抓取器无需执行 JavaScript 即可读取的分享元数据。 */
export function renderSharePageHtml(
  indexHtml: string,
  share: SharePreviewData,
  publicUrl: URL,
): string {
  const title = share.title?.trim() || DEFAULT_SHARE_TITLE
  const description = buildShareDescription(share.messages)
  const imageUrl = new URL(SHARE_IMAGE_PATH, publicUrl.origin).href
  const canonicalUrl = publicUrl.href
  const escapedTitle = escapeHtml(title)
  const escapedDescription = escapeHtml(description)
  const escapedCanonicalUrl = escapeHtml(canonicalUrl)
  const escapedImageUrl = escapeHtml(imageUrl)

  const metadata = [
    `<meta name="description" content="${escapedDescription}" />`,
    `<link rel="canonical" href="${escapedCanonicalUrl}" />`,
    '<meta property="og:type" content="article" />',
    '<meta property="og:site_name" content="HappyChat" />',
    '<meta property="og:locale" content="zh_CN" />',
    `<meta property="og:title" content="${escapedTitle}" />`,
    `<meta property="og:description" content="${escapedDescription}" />`,
    `<meta property="og:url" content="${escapedCanonicalUrl}" />`,
    `<meta property="og:image" content="${escapedImageUrl}" />`,
    '<meta property="og:image:type" content="image/png" />',
    '<meta property="og:image:width" content="512" />',
    '<meta property="og:image:height" content="512" />',
    '<meta property="og:image:alt" content="HappyChat" />',
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${escapedTitle}" />`,
    `<meta name="twitter:description" content="${escapedDescription}" />`,
    `<meta name="twitter:image" content="${escapedImageUrl}" />`,
  ]
    .map((tag) => `    ${tag}`)
    .join('\n')

  const htmlWithTitle = indexHtml.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapedTitle}</title>`,
  )
  return htmlWithTitle.replace('</head>', `${metadata}\n  </head>`)
}
