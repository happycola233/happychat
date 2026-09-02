import type { MessageDTO } from '@shared/types/api'
import type { ExportOptions } from '@shared/schemas/export'
import {
  attachmentDisplayName,
  attachmentRefsOf,
  dedupeCitations,
  encodeAssetHref,
  exportProcessSteps,
  exportHeaderNote,
  modelNameOf,
  sanitizeLinkText,
  sanitizeLinkUrl,
  statusLabel,
  textOfContent,
  searchLineOf,
  usageLine,
} from './content'
import { formatDurationShort, formatStamp } from './time'
import type { ExportSource } from './types'

/** 阅读友好的通用 Markdown 文档（GitHub / 任意编辑器可直接查看）。 */
export function buildMarkdown(source: ExportSource, options: ExportOptions): string {
  const out: string[] = []
  out.push(`# ${source.title}`)
  out.push(
    `> ${exportHeaderNote(source, formatStamp(source.exportedAt, source.timezone, 'minute'))}`,
  )

  for (const m of source.messages) {
    out.push(renderMessage(m, source, options))
  }
  return `${out.join('\n\n')}\n`
}

function renderMessage(m: MessageDTO, source: ExportSource, options: ExportOptions): string {
  const blocks: string[] = []
  blocks.push(header(m, source, options))

  const status = statusLabel(m)
  if (status) blocks.push(`> [!WARNING]\n> ${status}${statusDetail(m)}`)

  if ((options.includeReasoning || options.includeSearch) && m.role === 'assistant') {
    const thinking = processBlock(m, options)
    if (thinking) blocks.push(thinking)
  }

  for (const line of attachmentLines(m, source, options)) blocks.push(line)

  const body = textOfContent(m.content)
  if (body) blocks.push(body)

  if (options.includeCitations) {
    const cites = dedupeCitations(m.annotations)
    if (cites.length > 0) {
      const lines = ['**来源**', '']
      cites.forEach((c, i) => {
        lines.push(`${i + 1}. [${sanitizeLinkText(c.title || c.url)}](${sanitizeLinkUrl(c.url)})`)
      })
      blocks.push(lines.join('\n'))
    }
  }

  if (options.includeUsage) {
    const usage = usageLine(m)
    if (usage) blocks.push(`*${usage}*`)
  }

  return blocks.join('\n\n')
}

function header(m: MessageDTO, source: ExportSource, options: ExportOptions): string {
  const role = m.role === 'user' ? '🧑‍💻 用户' : m.role === 'system' ? '⚙️ 系统' : '🤖 助手'
  const fields: string[] = []
  if (options.timePrecision !== 'none') {
    fields.push(formatStamp(m.createdAt, source.timezone, options.timePrecision))
  }
  if (options.includeModel && m.role === 'assistant') {
    const model = modelNameOf(m)
    if (model) fields.push(model)
  }
  return `## ${role}${fields.map((f) => ` · ${f}`).join('')}`
}

function statusDetail(m: MessageDTO): string {
  if (m.status !== 'error' || !m.errorMessage) return ''
  return `：${m.errorMessage.replace(/[\r\n]+/g, ' ')}`
}

function processBlock(m: MessageDTO, options: ExportOptions): string | null {
  const steps = exportProcessSteps(m, options.includeReasoning, options.includeSearch)
  if (steps.length === 0 && (!options.includeReasoning || m.reasoningDurationMs == null))
    return null
  const hasThinking = steps.some((step) => step.kind !== 'search')
  const label =
    options.includeReasoning && m.reasoningDurationMs != null && m.reasoningDurationMs > 0
      ? `🤔 已思考 ${formatDurationShort(m.reasoningDurationMs)}`
      : hasThinking
        ? '🤔 思考过程'
        : '🌐 检索过程'
  const lines = [`> ${label}`]
  for (const step of steps) {
    lines.push('>')
    const text =
      step.kind === 'commentary'
        ? `💬 ${step.text}`
        : step.kind === 'search'
          ? `🔎 ${searchLineOf(step.action)}`
          : step.text
    for (const line of text.replace(/\r\n/g, '\n').trim().split('\n')) {
      lines.push(line ? `> ${line}` : '>')
    }
  }
  return lines.join('\n')
}

function attachmentLines(m: MessageDTO, source: ExportSource, options: ExportOptions): string[] {
  if (options.attachmentMode === 'omit') return []
  const lines: string[] = []
  for (const ref of attachmentRefsOf(m.content)) {
    const attachment = ref.attachmentId ? source.attachments.get(ref.attachmentId) : undefined
    const name = sanitizeLinkText(attachmentDisplayName(ref, attachment))
    const embedded =
      options.attachmentMode === 'embed' &&
      attachment &&
      !attachment.missing &&
      attachment.assetPath
    if (embedded) {
      const href = encodeAssetHref(attachment.assetPath!)
      lines.push(ref.kind === 'image' ? `![${name}](${href})` : `📄 [${name}](${href})`)
    } else {
      lines.push(`*${ref.kind === 'image' ? '🖼️' : '📄'} ${name}*`)
    }
    if (ref.generated && ref.revisedPrompt) {
      lines.push(`*生成提示词：${ref.revisedPrompt.replace(/[\r\n]+/g, ' ')}*`)
    }
  }
  return lines
}
