import type { MessageDTO } from '@shared/types/api'
import type { ContentPart, UrlCitation } from '@shared/types/domain'
import type { ExportAttachment, ExportSource } from './types'
import { formatDurationSeconds } from './time'

/**
 * 只去掉首尾的空白「行」，保留行内的缩进与行尾空格——
 * 整段 trim 会破坏首行缩进代码、行尾双空格硬换行等有效内容。
 */
function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
}

/** 消息正文纯文本：input_text / output_text 按顺序拼接，段落间空行。 */
export function textOfContent(content: ContentPart[]): string {
  const parts: string[] = []
  for (const p of content) {
    if ((p.type === 'input_text' || p.type === 'output_text') && p.text.trim()) {
      parts.push(trimBlankLines(p.text.replace(/\r\n/g, '\n')))
    }
  }
  return parts.join('\n\n')
}

/** 消息中一个附件引用（保持 content 内出现顺序）。 */
export interface AttachmentRef {
  attachmentId: string
  kind: 'image' | 'file'
  /** content 冗余存的文件名（input_file），附件行缺失时的兜底显示名 */
  filenameHint: string | null
  /** 是否为模型生成的图片（image_result） */
  generated: boolean
  revisedPrompt: string | null
}

export function attachmentRefsOf(content: ContentPart[]): AttachmentRef[] {
  const refs: AttachmentRef[] = []
  for (const p of content) {
    if (p.type === 'input_image') {
      refs.push({
        attachmentId: p.attachment_id,
        kind: 'image',
        filenameHint: null,
        generated: false,
        revisedPrompt: null,
      })
    } else if (p.type === 'input_file') {
      refs.push({
        attachmentId: p.attachment_id,
        kind: 'file',
        filenameHint: p.filename,
        generated: false,
        revisedPrompt: null,
      })
    } else if (p.type === 'image_result') {
      refs.push({
        attachmentId: p.attachment_id,
        kind: 'image',
        filenameHint: null,
        generated: true,
        revisedPrompt: p.revised_prompt ?? null,
      })
    }
  }
  return refs
}

/** 附件的显示名：附件行文件名优先，缺失时回退 content 提示名 / 占位。 */
export function attachmentDisplayName(
  ref: AttachmentRef,
  attachment: ExportAttachment | undefined,
): string {
  const name = attachment?.filename || ref.filenameHint
  if (name) return name
  return ref.kind === 'image' ? (ref.generated ? '生成的图片' : '图片') : '文件'
}

/** 引用来源按 URL 去重（与消息 UI 同口径），保持首次出现顺序。 */
export function dedupeCitations(annotations: UrlCitation[] | null | undefined): UrlCitation[] {
  if (!annotations?.length) return []
  const seen = new Set<string>()
  const out: UrlCitation[] = []
  for (const c of annotations) {
    if (!c.url || seen.has(c.url)) continue
    seen.add(c.url)
    out.push(c)
  }
  return out
}

/** 非正常完成状态的中文标注（complete 返回 null）。 */
export function statusLabel(m: MessageDTO): string | null {
  if (m.status === 'complete') return null
  if (m.status === 'streaming') return '生成中'
  if (m.status === 'interrupted') {
    return m.errorMessage === '已停止生成' ? '已停止生成' : '生成中断'
  }
  return '生成失败'
}

/** 用量统计的单行文本（markdown/html/txt 共用文案）。 */
export function usageLine(m: MessageDTO): string | null {
  const u = m.usage
  if (!u) return null
  const parts: string[] = []
  const inputExtra: string[] = []
  if (u.cacheWriteTokens) inputExtra.push(`缓存写入 ${u.cacheWriteTokens}`)
  if (u.cachedTokens) inputExtra.push(`缓存读取 ${u.cachedTokens}`)
  parts.push(`输入 ${u.inputTokens}${inputExtra.length ? `（${inputExtra.join('，')}）` : ''}`)
  parts.push(
    `输出 ${u.outputTokens}${u.reasoningTokens ? `（推理 ${u.reasoningTokens}）` : ''}`,
  )
  parts.push(`合计 ${u.totalTokens} tokens`)
  if (m.generationDurationMs != null && m.generationDurationMs > 0) {
    parts.push(`耗时 ${formatDurationSeconds(m.generationDurationMs)}`)
  }
  return parts.join(' · ')
}

/** 联网搜索过程的逐步文字描述（按动作发生顺序）。 */
export function webSearchLines(m: MessageDTO): string[] {
  const actions = m.webSearchActions
  if (!actions?.length) return []
  const lines: string[] = []
  for (const a of actions) {
    if (a.type === 'search') {
      lines.push(a.queries?.length ? `搜索：${a.queries.map((q) => `「${q}」`).join(' ')}` : '搜索')
    } else if (a.type === 'open_page') {
      lines.push(a.url ? `打开页面：${a.url}` : '打开页面')
    } else {
      const target = a.url ? `：${a.url}` : ''
      lines.push(a.pattern ? `页内查找「${a.pattern}」${target}` : `页内查找${target}`)
    }
  }
  return lines
}

/** 模型显示名（modelLabel 快照优先）；用户消息返回 null。 */
export function modelNameOf(m: MessageDTO): string | null {
  if (m.role !== 'assistant') return null
  return m.modelLabel ?? null
}

/**
 * 清洗为跨平台安全的文件名：去除 Windows/Unix 非法字符与控制符、
 * 折叠空白、去首尾点号，并按码点限长（中文标题按字符数截断）。
 */
export function sanitizeFilename(name: string, fallback = '未命名聊天'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim()
  const sliced = [...cleaned].slice(0, 60).join('').trim()
  return sliced || fallback
}

/** Markdown 链接文本中的中括号会破坏链接语法，替换为全角。 */
export function sanitizeLinkText(text: string): string {
  return text.replace(/\[/g, '［').replace(/\]/g, '］').replace(/[\r\n]+/g, ' ')
}

const pct = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`

/**
 * assets/ 相对路径 → Markdown 链接目标：只编码会破坏 CommonMark 链接
 * 解析或 URL 解析的字符（空格断开目标、括号截断、`#` 成为 fragment、
 * `%` 与已有转义混淆），中文等非 ASCII 保持原样以保住导出文件的可读性。
 */
export function encodeAssetHref(path: string): string {
  return path.replace(/[ %#?()<>]/g, pct)
}

/**
 * 外部 URL 进入 Markdown 链接目标前的清洗：百分号编码空白、控制字符与
 * 括号/尖括号。含换行的恶意 URL 否则可伪造 chatlog-md 的行首哨兵结构。
 */
export function sanitizeLinkUrl(url: string): string {
  let out = ''
  for (const ch of url) {
    const cp = ch.codePointAt(0)!
    out += cp <= 0x20 || cp === 0x7f || '()<>'.includes(ch) ? pct(ch) : ch
  }
  return out
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
}

/**
 * 为 embed 模式的附件分配 assets/ 内的唯一相对路径：
 * 原文件名清洗后去重（重名追加 -2、-3…），无扩展名时按 MIME 补全。
 */
export function assignAssetPaths(attachments: Iterable<ExportAttachment>): void {
  const used = new Set<string>()
  for (const a of attachments) {
    if (a.missing) continue
    const base = sanitizeFilename(a.filename, a.id)
    const dot = base.lastIndexOf('.')
    let stem = dot > 0 ? base.slice(0, dot) : base
    let ext = dot > 0 ? base.slice(dot) : (MIME_EXT[a.mime] ?? '')
    // 极端情况下 stem 可能为空（如文件名是 ".png"）
    if (!stem) stem = a.id
    if (ext === '.') ext = ''
    let candidate = `${stem}${ext}`
    for (let i = 2; used.has(candidate.toLowerCase()); i++) {
      candidate = `${stem}-${i}${ext}`
    }
    used.add(candidate.toLowerCase())
    a.assetPath = `assets/${candidate}`
  }
}

/** 会话内消息条数与时间范围等导出头部元信息的通用取材。 */
export function exportHeaderNote(source: ExportSource, stamp: string): string {
  return `导出自 HappyChat · ${stamp} · 共 ${source.messages.length} 条消息`
}
