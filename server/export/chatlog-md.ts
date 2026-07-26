import type { MessageDTO } from '@shared/types/api'
import type { ExportOptions } from '@shared/schemas/export'
import {
  attachmentDisplayName,
  attachmentRefsOf,
  dedupeCitations,
  encodeAssetHref,
  modelNameOf,
  sanitizeLinkText,
  sanitizeLinkUrl,
  statusLabel,
  textOfContent,
} from './content'
import { formatDurationShort, formatLocalDate, formatStamp, formatWeekdayZh } from './time'
import type { ExportSource } from './types'

/**
 * chatlog-md/1 构建器（规范：dialogary 的《chatlog-md 格式规范 v1》，
 * https://github.com/happycola233/dialogary/blob/main/chatlog-md-%E6%A0%BC%E5%BC%8F%E8%A7%84%E8%8C%83.md）。
 *
 * 解析器只识别少数行首哨兵：front matter、`# @日期`、`## … @角色`、
 * 首块 `> 🤔`、`🖼️ `/`📄 ` 附件行、`<!-- @meta -->`。除此之外的正文
 * 一律原样透传，正文中撞哨兵语法的行按规范 §10 加反斜杠转义。
 */
export function buildChatlogMd(source: ExportSource, options: ExportOptions): string {
  const out: string[] = []
  out.push(frontMatter(source))

  const showTime = options.timePrecision !== 'none'
  let currentDate: string | null = null

  for (const m of source.messages) {
    if (showTime) {
      const date = formatLocalDate(m.createdAt, source.timezone)
      if (date !== currentDate) {
        currentDate = date
        out.push(`# @${date} · ${formatWeekdayZh(m.createdAt, source.timezone)}`)
      }
    }
    out.push(renderMessage(m, source, options))
  }

  return `${out.join('\n\n')}\n`
}

function frontMatter(source: ExportSource): string {
  const lines = ['---', 'format: chatlog-md/1', `title: ${yamlValue(source.title)}`]
  lines.push(`timezone: ${yamlValue(source.timezone)}`)
  // 规范 §4：未识别的键会被解析器保留并忽略，扩展键安全
  lines.push('exported_by: HappyChat')
  lines.push(`exported_at: ${yamlValue(formatStamp(source.exportedAt, source.timezone, 'second'))}`)
  lines.push('---')
  return lines.join('\n')
}

/** YAML 标量：含特殊字符、首尾空白或会被解析成非字符串类型时用 JSON 双引号形式（YAML 兼容）。 */
function yamlValue(value: string): string {
  // true/no/null/数字/日期等裸写会被 YAML 解析为布尔/空值/数字，必须加引号
  const ambiguous =
    /^(?:true|false|yes|no|on|off|null|~)$/i.test(value) || /^[+-]?(?:\d|\.\d)/.test(value)
  if (!ambiguous && /^[^\s#&*!|>'"%@`[\]{},:-][^#:\n]*$/.test(value) && !/\s$/.test(value)) {
    return value
  }
  return JSON.stringify(value)
}

function renderMessage(m: MessageDTO, source: ExportSource, options: ExportOptions): string {
  const blocks: string[] = []
  blocks.push(header(m, source, options))

  const meta = metaLine(m, options)
  if (meta) blocks.push(meta)

  let hasThinking = false
  if (options.includeReasoning && m.role === 'assistant') {
    const thinking = thinkingBlock(m)
    if (thinking) {
      blocks.push(thinking)
      hasThinking = true
    }
  }

  for (const line of attachmentLines(m, source, options)) blocks.push(line)

  const body = bodyBlock(m, hasThinking)
  if (body) blocks.push(body)

  if (options.includeCitations) {
    const cites = citationBlock(m)
    if (cites) blocks.push(cites)
  }

  return blocks.join('\n\n')
}

function header(m: MessageDTO, source: ExportSource, options: ExportOptions): string {
  // 规范 §6：@角色 前的装饰（emoji）解析器忽略；字段用 U+00B7 中点分隔
  const decor = m.role === 'user' ? '🧑‍💻 @user' : m.role === 'system' ? '⚙️ @system' : '🤖 @ai'
  const fields: string[] = []
  if (options.timePrecision !== 'none') {
    fields.push(formatStamp(m.createdAt, source.timezone, options.timePrecision))
  }
  if (options.includeModel && m.role === 'assistant') {
    // 模型名里的中点/换行会破坏字段分隔语法，替换掉；清洗后为空则整个字段省略
    const model = modelNameOf(m)?.replace(/·/g, '.').replace(/[\r\n]+/g, ' ').trim()
    if (model) fields.push(model)
  }
  return `## ${decor}${fields.map((f) => ` · ${f}`).join('')}`
}

/** 消息级扩展元数据：状态、错误信息、Token 用量（规范 §9 的 @meta 扩展点）。 */
function metaLine(m: MessageDTO, options: ExportOptions): string | null {
  const pairs: string[] = []
  const status = statusLabel(m)
  if (status) {
    pairs.push(`status=${m.status}`)
    pairs.push(`status_label=${metaValue(status)}`)
  }
  if (m.errorMessage && m.errorMessage !== '已停止生成') {
    pairs.push(`error=${metaValue(m.errorMessage)}`)
  }
  if (options.includeUsage && m.usage) {
    const u = m.usage
    pairs.push(`input_tokens=${u.inputTokens}`)
    if (u.cacheWriteTokens) pairs.push(`cache_write_tokens=${u.cacheWriteTokens}`)
    if (u.cachedTokens) pairs.push(`cached_tokens=${u.cachedTokens}`)
    pairs.push(`output_tokens=${u.outputTokens}`)
    if (u.reasoningTokens) pairs.push(`reasoning_tokens=${u.reasoningTokens}`)
    pairs.push(`total_tokens=${u.totalTokens}`)
    if (m.generationDurationMs != null && m.generationDurationMs > 0) {
      pairs.push(`generation_ms=${m.generationDurationMs}`)
    }
  }
  if (pairs.length === 0) return null
  return `<!-- @meta ${pairs.join(' ')} -->`
}

/** @meta 的 value：含空格用双引号包裹；内部双引号/换行替换为安全字符。 */
function metaValue(value: string): string {
  const cleaned = value.replace(/"/g, '”').replace(/[\r\n]+/g, ' ').replace(/-->/g, '—>')
  return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned
}

/** 思考块（规范 §7）：AI 消息正文的第一个块，`> 🤔 标记行` + 引用体。 */
function thinkingBlock(m: MessageDTO): string | null {
  const text = (m.reasoningSummary ?? '').replace(/\r\n/g, '\n').trim()
  if (!text && m.reasoningDurationMs == null) return null
  const label =
    m.reasoningDurationMs != null && m.reasoningDurationMs > 0
      ? `已思考 ${formatDurationShort(m.reasoningDurationMs)}`
      : '思考摘要'
  const lines = [`> 🤔 ${label}`]
  if (text) {
    lines.push('>')
    for (const line of text.split('\n')) lines.push(line ? `> ${line}` : '>')
  }
  return lines.join('\n')
}

function attachmentLines(m: MessageDTO, source: ExportSource, options: ExportOptions): string[] {
  if (options.attachmentMode === 'omit') return []
  const lines: string[] = []
  for (const ref of attachmentRefsOf(m.content)) {
    const attachment = ref.attachmentId ? source.attachments.get(ref.attachmentId) : undefined
    const icon = ref.kind === 'image' ? '🖼️' : '📄'
    const name = sanitizeLinkText(attachmentDisplayName(ref, attachment))
    const embedded =
      options.attachmentMode === 'embed' && attachment && !attachment.missing && attachment.assetPath
    // 规范 §8：已保存的附件用链接形（相对路径 assets/，百分号编码），否则纯名形
    let line = embedded
      ? `${icon} [${name}](${encodeAssetHref(attachment.assetPath!)})`
      : `${icon} ${name}`
    if (ref.generated) {
      const pairs = ['generated=true']
      if (ref.revisedPrompt) pairs.push(`prompt=${metaValue(truncate(ref.revisedPrompt, 300))}`)
      line += `\n<!-- @meta ${pairs.join(' ')} -->`
    }
    lines.push(line)
  }
  return lines
}

function truncate(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`
}

/**
 * 正文块：撞哨兵语法的行按规范 §10 行首加反斜杠。
 * `> 🤔` 只有位于消息正文第一个块才是哨兵，仅在该位置转义。
 */
function bodyBlock(m: MessageDTO, hasThinking: boolean): string | null {
  const text = textOfContent(m.content)
  if (!text) return null
  const lines = text.split('\n').map(escapeSentinelLine)
  if (!hasThinking) {
    // 找到第一个非空行：若以 > 🤔 开头会被解析器误认为思考块（同样按 §10 补一个 \）
    const idx = lines.findIndex((l) => l.trim() !== '')
    if (idx >= 0 && /^>\s*🤔/.test(lines[idx]!.replace(/^\\+/, ''))) lines[idx] = `\\${lines[idx]}`
  }
  return lines.join('\n')
}

// 与规范 §5/§6 的正则同等严格：日期后如有文字必须用 · 分隔，否则不是哨兵
const DATE_HEAD_RE = /^#\s+@\d{4}-\d{2}-\d{2}(?:\s*·\s*.+)?\s*$/
const MSG_HEAD_RE = /^##\s+[^@\r\n]*@(?:user|ai|system)(?:\s*·\s*[^·\r\n]+)*\s*$/
const ATTACH_RE = /^(?:🖼️|📄)\s/
const META_RE = /^<!--\s*@meta\b/

function matchesSentinel(line: string): boolean {
  return (
    DATE_HEAD_RE.test(line) || MSG_HEAD_RE.test(line) || ATTACH_RE.test(line) || META_RE.test(line)
  )
}

/**
 * 规范 §10：解析器剥掉一个行首 \ 后按正文处理。写入侧对称地对
 * 「任意个 \ + 哨兵语法」的行统一再补一个 \（`🖼️ x`→`\🖼️ x`、
 * `\🖼️ x`→`\\🖼️ x`…），与递归剥一层的解析规则构成无损往返。
 */
function escapeSentinelLine(line: string): string {
  if (matchesSentinel(line.replace(/^\\+/, ''))) return `\\${line}`
  return line
}

/** 引用来源列表：作为正文尾部的普通 Markdown 内容（不是哨兵）。 */
function citationBlock(m: MessageDTO): string | null {
  const cites = dedupeCitations(m.annotations)
  if (cites.length === 0) return null
  const lines = ['**来源**', '']
  cites.forEach((c, i) => {
    const title = sanitizeLinkText(c.title || hostOf(c.url))
    // URL 经清洗防止换行/括号伪造行首哨兵或破坏链接语法
    lines.push(`${i + 1}. [${title}](${sanitizeLinkUrl(c.url)})`)
  })
  return lines.join('\n')
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
