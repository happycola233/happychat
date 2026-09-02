import type { MessageDTO } from '@shared/types/api'
import type { ContentPart, ProcessStep, SearchAction, UrlCitation } from '@shared/types/domain'
import { processStepsOf, searchActionsOf } from '@shared/util/processTrack'
import { xPostUrl } from '@shared/util/searchActivity'
import { safeHttpUrl } from '@shared/util/url'
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

/** 只保留 http(s) 引用并按规范化 URL 去重（与消息 UI 同口径）。 */
export function dedupeCitations(annotations: UrlCitation[] | null | undefined): UrlCitation[] {
  if (!annotations?.length) return []
  const seen = new Set<string>()
  const out: UrlCitation[] = []
  for (const c of annotations) {
    const safeUrl = safeHttpUrl(c.url)
    if (!safeUrl || seen.has(safeUrl)) continue
    seen.add(safeUrl)
    out.push({ ...c, url: safeUrl })
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
  parts.push(`输出 ${u.outputTokens}${u.reasoningTokens ? `（推理 ${u.reasoningTokens}）` : ''}`)
  parts.push(`合计 ${u.totalTokens} tokens`)
  if (m.generationDurationMs != null && m.generationDurationMs > 0) {
    parts.push(`耗时 ${formatDurationSeconds(m.generationDurationMs)}`)
  }
  return parts.join(' · ')
}

/** 排序模式与 UI 同口径译成自解释短语（导出是纯文本，更不能只写一个「最新」）。 */
const X_SEARCH_MODE_LABELS: Record<string, string> = {
  Latest: '按最新排序',
  Top: '按热门排序',
}

/** x_search 动作的附加限定条件（账号 / 时间范围 / 排序）拼成一个括号后缀。 */
function xSearchScopeSuffix(a: SearchAction): string {
  const scopes: string[] = []
  if (a.handles?.length) scopes.push(`仅 ${a.handles.map((h) => `@${h}`).join(' ')}`)
  if (a.excludedHandles?.length)
    scopes.push(`排除 ${a.excludedHandles.map((h) => `@${h}`).join(' ')}`)
  if (a.fromDate || a.toDate) {
    scopes.push(`${a.fromDate ?? '不限'} ~ ${a.toDate ?? '今天'}`)
  }
  if (a.mode) scopes.push(X_SEARCH_MODE_LABELS[a.mode] ?? `按 ${a.mode} 排序`)
  return scopes.length ? `（${scopes.join('，')}）` : ''
}

/** 检索过程的逐步文字描述（web_search 与 x_search 按动作发生顺序混排）。 */
export function searchLineOf(a: SearchAction): string {
  const quoted = a.queries?.length ? a.queries.map((query) => `「${query}」`).join(' ') : ''
  switch (a.type) {
    case 'search':
      return a.error ? `搜索失败（${a.error}）` : quoted ? `搜索：${quoted}` : '搜索'
    case 'open_page':
      return a.url ? `打开页面：${a.url}` : '打开页面'
    case 'find_in_page': {
      const target = a.url ? `：${a.url}` : ''
      return a.pattern ? `页内查找「${a.pattern}」${target}` : `页内查找${target}`
    }
    case 'x_user_search':
      return quoted ? `X 用户检索：${quoted}` : 'X 用户检索'
    case 'x_thread_fetch':
      return a.postId ? `读取 X 讨论串：${xPostUrl(a.postId)}` : '读取 X 讨论串'
    default: {
      const label = a.type === 'x_semantic_search' ? 'X 语义检索' : 'X 检索'
      return `${label}${quoted ? `：${quoted}` : ''}${xSearchScopeSuffix(a)}`
    }
  }
}

/** 检索过程的逐步文字描述（新旧消息均经适配器读取）。 */
export function searchLines(m: MessageDTO): string[] {
  return searchActionsOf(m).map(searchLineOf)
}

/** 按导出选项筛选统一过程轨；commentary 与 reasoning 共用「思考过程」选项。 */
export function exportProcessSteps(
  m: MessageDTO,
  includeReasoning: boolean,
  includeSearch: boolean,
): ProcessStep[] {
  return processStepsOf(m).filter((step) =>
    step.kind === 'search' ? includeSearch : includeReasoning,
  )
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
  return text
    .replace(/\[/g, '［')
    .replace(/\]/g, '］')
    .replace(/[\r\n]+/g, ' ')
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
