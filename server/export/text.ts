import type { MessageDTO } from '@shared/types/api'
import type { ExportOptions } from '@shared/schemas/export'
import {
  attachmentDisplayName,
  attachmentRefsOf,
  dedupeCitations,
  exportHeaderNote,
  modelNameOf,
  statusLabel,
  textOfContent,
  usageLine,
  searchLines,
} from './content'
import { formatDurationShort, formatStamp } from './time'
import type { ExportSource } from './types'

const DIVIDER = '─'.repeat(40)

/** 最通用的纯文本记录。 */
export function buildText(source: ExportSource, options: ExportOptions): string {
  const out: string[] = []
  out.push(
    [
      source.title,
      exportHeaderNote(source, formatStamp(source.exportedAt, source.timezone, 'minute')),
      DIVIDER,
    ].join('\n'),
  )

  for (const m of source.messages) {
    out.push(renderMessage(m, source, options))
  }
  return `${out.join('\n\n')}\n`
}

function renderMessage(m: MessageDTO, source: ExportSource, options: ExportOptions): string {
  const lines: string[] = []
  lines.push(header(m, source, options))

  const status = statusLabel(m)
  if (status) {
    const detail = m.status === 'error' && m.errorMessage ? `：${m.errorMessage}` : ''
    lines.push(`  〔${status}${detail}〕`)
  }

  if (options.includeReasoning && m.role === 'assistant') {
    const text = (m.reasoningSummary ?? '').replace(/\r\n/g, '\n').trim()
    if (text || m.reasoningDurationMs != null) {
      const label =
        m.reasoningDurationMs != null && m.reasoningDurationMs > 0
          ? `已思考 ${formatDurationShort(m.reasoningDurationMs)}`
          : '思考摘要'
      lines.push(`  〔${label}〕`)
      for (const l of text.split('\n')) if (l.trim()) lines.push(`  │ ${l}`)
    }
  }

  if (options.includeSearch) {
    for (const l of searchLines(m)) lines.push(`  〔检索〕${l}`)
  }

  if (options.attachmentMode !== 'omit') {
    for (const ref of attachmentRefsOf(m.content)) {
      const attachment = ref.attachmentId ? source.attachments.get(ref.attachmentId) : undefined
      const name = attachmentDisplayName(ref, attachment)
      const kind = ref.kind === 'image' ? (ref.generated ? '生成图片' : '图片') : '文件'
      const embedded =
        options.attachmentMode === 'embed' &&
        attachment &&
        !attachment.missing &&
        attachment.assetPath
      lines.push(`  〔${kind}〕${embedded ? attachment.assetPath : name}`)
    }
  }

  const body = textOfContent(m.content)
  if (body) {
    if (lines.length > 1) lines.push('')
    lines.push(body)
  }

  if (options.includeCitations) {
    const cites = dedupeCitations(m.annotations)
    if (cites.length > 0) {
      lines.push('')
      cites.forEach((c, i) => lines.push(`  〔来源 ${i + 1}〕${c.title ? `${c.title} — ` : ''}${c.url}`))
    }
  }

  if (options.includeUsage) {
    const usage = usageLine(m)
    if (usage) lines.push(`  〔用量〕${usage}`)
  }

  return lines.join('\n')
}

function header(m: MessageDTO, source: ExportSource, options: ExportOptions): string {
  const role = m.role === 'user' ? '用户' : m.role === 'system' ? '系统' : '助手'
  const stamp =
    options.timePrecision !== 'none'
      ? `[${formatStamp(m.createdAt, source.timezone, options.timePrecision)}] `
      : ''
  const model =
    options.includeModel && m.role === 'assistant' && modelNameOf(m)
      ? `（${modelNameOf(m)}）`
      : ''
  return `${stamp}${role}${model}`
}
