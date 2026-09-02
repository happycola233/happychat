import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import type { MessageDTO } from '@shared/types/api'
import type { ExportOptions } from '@shared/schemas/export'
import {
  attachmentDisplayName,
  attachmentRefsOf,
  dedupeCitations,
  exportProcessSteps,
  exportHeaderNote,
  modelNameOf,
  statusLabel,
  textOfContent,
  searchLineOf,
  usageLine,
} from './content'
import { formatDurationShort, formatStamp } from './time'
import type { ExportAttachment, ExportSource } from './types'

/**
 * Markdown → 安全 HTML：与站内渲染同一思路（raw HTML 经 sanitize 白名单过滤），
 * 保证导出文件是自包含且不含可执行脚本的静态页面。
 */
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize)
  .use(rehypeStringify)

function renderMarkdown(text: string): string {
  return String(markdownProcessor.processSync(text))
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 自包含单文件网页：附件内联 data URI，浅色/深色随系统自动切换。 */
export function buildHtml(source: ExportSource, options: ExportOptions): string {
  const note = exportHeaderNote(source, formatStamp(source.exportedAt, source.timezone, 'minute'))
  const body = source.messages.map((m) => messageHtml(m, source, options)).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="HappyChat">
<title>${esc(source.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header class="page">
<h1>${esc(source.title)}</h1>
<p class="meta">${esc(note)}</p>
</header>
${body}
</main>
</body>
</html>
`
}

function messageHtml(m: MessageDTO, source: ExportSource, options: ExportOptions): string {
  const isUser = m.role === 'user'
  const who = isUser ? '🧑‍💻 用户' : m.role === 'system' ? '⚙️ 系统' : '🤖 助手'
  const parts: string[] = []

  const head: string[] = [`<span class="who">${who}</span>`]
  if (options.timePrecision !== 'none') {
    head.push(
      `<time>${esc(formatStamp(m.createdAt, source.timezone, options.timePrecision))}</time>`,
    )
  }
  if (options.includeModel && m.role === 'assistant') {
    const model = modelNameOf(m)
    if (model) head.push(`<span class="model">${esc(model)}</span>`)
  }
  const status = statusLabel(m)
  if (status) {
    const detail = m.status === 'error' && m.errorMessage ? `：${m.errorMessage}` : ''
    head.push(`<span class="status">${esc(status + detail)}</span>`)
  }
  parts.push(`<div class="head">${head.join('')}</div>`)

  if ((options.includeReasoning || options.includeSearch) && m.role === 'assistant') {
    const steps = exportProcessSteps(m, options.includeReasoning, options.includeSearch)
    if (steps.length > 0 || (options.includeReasoning && m.reasoningDurationMs != null)) {
      const hasThinking = steps.some((step) => step.kind !== 'search')
      const label =
        options.includeReasoning && m.reasoningDurationMs != null && m.reasoningDurationMs > 0
          ? `🤔 已思考 ${formatDurationShort(m.reasoningDurationMs)}`
          : hasThinking
            ? '🤔 思考过程'
            : '🌐 检索过程'
      const processHtml = steps
        .map((step) => {
          if (step.kind === 'search') {
            return `<div class="process-search">🔎 ${esc(searchLineOf(step.action))}</div>`
          }
          const text = step.kind === 'commentary' ? `💬 ${step.text}` : step.text
          return `<div class="md process-${step.kind}">${renderMarkdown(text)}</div>`
        })
        .join('')
      parts.push(
        `<details class="think"><summary>${esc(label)}</summary>` + processHtml + `</details>`,
      )
    }
  }

  const attachmentsHtml = attachmentBlocks(m, source, options)
  const bodyText = textOfContent(m.content)
  const bodyHtml = bodyText ? `<div class="md">${renderMarkdown(bodyText)}</div>` : ''

  if (isUser) {
    // 用户消息按站内样式渲染为右对齐气泡（附件在气泡上方）
    const bubbleParts = [...attachmentsHtml, bodyHtml].filter(Boolean).join('\n')
    if (bubbleParts) parts.push(`<div class="bubble">${bubbleParts}</div>`)
  } else {
    parts.push(...attachmentsHtml)
    if (bodyHtml) parts.push(bodyHtml)
  }

  if (options.includeCitations) {
    const cites = dedupeCitations(m.annotations)
    if (cites.length > 0) {
      parts.push(
        `<div class="cites"><div class="label">来源</div><ol>${cites
          .map(
            (c) =>
              `<li><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(
                c.title || c.url,
              )}</a></li>`,
          )
          .join('')}</ol></div>`,
      )
    }
  }

  if (options.includeUsage) {
    const usage = usageLine(m)
    if (usage) parts.push(`<p class="usage">${esc(usage)}</p>`)
  }

  return `<section class="msg ${isUser ? 'user' : 'assistant'}">\n${parts
    .filter(Boolean)
    .join('\n')}\n</section>`
}

function attachmentBlocks(m: MessageDTO, source: ExportSource, options: ExportOptions): string[] {
  if (options.attachmentMode === 'omit') return []
  const blocks: string[] = []
  for (const ref of attachmentRefsOf(m.content)) {
    const attachment = ref.attachmentId ? source.attachments.get(ref.attachmentId) : undefined
    const name = attachmentDisplayName(ref, attachment)
    const embeddable =
      options.attachmentMode === 'embed' && attachment && !attachment.missing && attachment.data
    if (embeddable) {
      const uri = dataUri(attachment)
      if (ref.kind === 'image') {
        const caption = ref.revisedPrompt
          ? `<figcaption>${esc(ref.revisedPrompt)}</figcaption>`
          : ''
        blocks.push(
          `<figure class="att"><img src="${uri}" alt="${esc(name)}" loading="lazy">${caption}</figure>`,
        )
      } else {
        blocks.push(`<a class="att-file" href="${uri}" download="${esc(name)}">📄 ${esc(name)}</a>`)
      }
    } else {
      const missingNote = attachment?.missing || !attachment ? '（文件未包含）' : ''
      blocks.push(
        `<span class="att-chip">${ref.kind === 'image' ? '🖼️' : '📄'} ${esc(name)}${missingNote}</span>`,
      )
    }
  }
  return blocks
}

function dataUri(a: ExportAttachment): string {
  return `data:${a.mime};base64,${Buffer.from(a.data!).toString('base64')}`
}

/** 页面样式：跟随系统浅色/深色，排版对齐站内阅读体验。 */
const CSS = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#fafafa;color:#171717;line-height:1.75;-webkit-font-smoothing:antialiased}
main{max-width:48rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
header.page h1{font-size:1.5rem;line-height:1.4;margin:0 0 .4rem}
header.page .meta{color:#737373;font-size:.8125rem;margin:0}
.msg{margin:2rem 0}
.head{display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;font-size:.78125rem;color:#a3a3a3;margin-bottom:.55rem}
.head .who{font-size:.875rem;font-weight:600;color:#404040}
.head .model{border:1px solid #e5e5e5;border-radius:999px;padding:.05rem .5rem}
.head .status{color:#d97706}
.msg.user .head{justify-content:flex-end}
.msg.user .bubble{margin-left:auto;width:fit-content;max-width:85%;background:#e0f2fe;border-radius:1.25rem;padding:.35rem 1rem}
.think{margin:.6rem 0;border:1px solid #e5e5e5;border-radius:.9rem;padding:.5rem .9rem;font-size:.875rem}
.think summary{cursor:pointer;color:#737373;user-select:none}
.think .md{margin-top:.4rem;color:#525252}
.think .process-search{margin-top:.4rem;color:#737373}
.think .process-commentary{color:#404040}
.search,.cites{margin:.6rem 0;font-size:.8125rem;color:#737373}
.search .label,.cites .label{font-weight:600;color:#525252;margin-bottom:.15rem}
.search ul,.cites ol{margin:.2rem 0 0;padding-left:1.4rem}
.search li,.cites li{margin:.12rem 0}
.usage{font-size:.75rem;color:#a3a3a3;margin:.5rem 0 0}
.att{margin:.6rem 0}
.att img{display:block;max-width:min(22rem,100%);border-radius:.9rem;border:1px solid #e5e5e5}
.att figcaption{font-size:.75rem;color:#a3a3a3;margin-top:.3rem}
.att-file,.att-chip{display:inline-flex;align-items:center;gap:.35rem;border:1px solid #e5e5e5;border-radius:.75rem;padding:.35rem .75rem;font-size:.8125rem;color:#525252;text-decoration:none;margin:.15rem .3rem .15rem 0;background:#fff}
a{color:#0284c7}
.md :first-child{margin-top:0}
.md :last-child{margin-bottom:0}
.md p{margin:.6rem 0}
.md pre{background:#171717;color:#e5e5e5;border-radius:.75rem;padding:.9rem 1rem;overflow-x:auto;font-size:.8125rem;line-height:1.6}
.md code{font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;font-size:.875em}
.md :not(pre)>code{background:#ececec;border-radius:.35rem;padding:.1rem .35rem}
.md blockquote{margin:.8rem 0;padding:.1rem 1rem;border-left:3px solid #d4d4d4;color:#737373}
.md table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}
.md th,.md td{border:1px solid #e5e5e5;padding:.4rem .75rem;font-size:.875rem}
.md img{max-width:100%;border-radius:.5rem}
.md hr{border:none;border-top:1px solid #e5e5e5;margin:1.5rem 0}
@media (prefers-color-scheme:dark){
body{background:#171717;color:#e5e5e5}
header.page .meta{color:#737373}
.head .who{color:#d4d4d4}
.head .model{border-color:#404040}
.msg.user .bubble{background:#1e3a5f}
.think{border-color:#333}
.think summary{color:#a3a3a3}
.think .md{color:#a3a3a3}
.think .process-commentary{color:#d4d4d4}
.search .label,.cites .label{color:#a3a3a3}
.att img{border-color:#333}
.att-file,.att-chip{border-color:#404040;background:#262626;color:#d4d4d4}
a{color:#38bdf8}
.md :not(pre)>code{background:#262626}
.md pre{background:#0a0a0a;border:1px solid #262626}
.md blockquote{border-left-color:#404040;color:#a3a3a3}
.md th,.md td{border-color:#333}
.md hr{border-top-color:#333}
}
`
