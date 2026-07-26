import type { ExportOptions } from '@shared/schemas/export'
import type { ExportPreviewDTO } from '@shared/types/api'
import { EXPORT_FORMAT_CAPS, normalizeExportOptions } from '@shared/util/exportOptions'
import { buildZip, ZIP_MAX_ENTRIES, type ZipEntry } from './archive'
import { buildChatlogMd } from './chatlog-md'
import { collectExportSource, newEmbedBudget } from './collect'
import { sanitizeFilename } from './content'
import { buildHtml } from './html'
import { buildJson } from './json'
import { buildJsonlLine } from './jsonl'
import { buildMarkdown } from './markdown'
import { buildText } from './text'
import { formatLocalDate } from './time'
import type { BuiltExport, ExportAttachment, ExportSource } from './types'

export type ExportErrorCode =
  | 'not_found'
  | 'empty_selection'
  | 'attachments_too_large'
  | 'too_many_files'

export type ExportResult = { ok: true; file: BuiltExport } | { ok: false; code: ExportErrorCode }

export type ExportBatchResult =
  | { ok: true; file: BuiltExport; exportedCount: number }
  | { ok: false; code: ExportErrorCode }

export type ExportPreviewResult =
  | { ok: true; preview: ExportPreviewDTO }
  | { ok: false; code: ExportErrorCode }

const encoder = new TextEncoder()

/** 预览文本的最大长度（UTF-16 单元，弹窗内滚动展示，无需全文）。 */
const PREVIEW_MAX_CHARS = 16_000

/**
 * 导出构建的全局并发闸：embed 导出会把附件全量读入内存再打包，
 * 单请求峰值可达字节预算的量级，放任并发会耗尽进程内存。
 */
const MAX_CONCURRENT_EXPORTS = 2
let exportSlots = MAX_CONCURRENT_EXPORTS
const exportWaiters: (() => void)[] = []

async function withExportSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (exportSlots > 0) exportSlots--
  else await new Promise<void>((resolve) => exportWaiters.push(resolve))
  try {
    return await fn()
  } finally {
    const next = exportWaiters.shift()
    // 名额直接移交下一位等待者，避免「释放-获取」间隙被新请求插队超发
    if (next) next()
    else exportSlots++
  }
}

/** 主文件文本；jsonl 在会话无任何有效样本时返回 null（调用方按无内容处理）。 */
function buildMainText(source: ExportSource, options: ExportOptions): string | null {
  switch (options.format) {
    case 'chatlog-md':
      return buildChatlogMd(source, options)
    case 'markdown':
      return buildMarkdown(source, options)
    case 'html':
      return buildHtml(source, options)
    case 'json':
      return buildJson(source, options)
    case 'jsonl': {
      const line = buildJsonlLine(source, options)
      return line === null ? null : `${line}\n`
    }
    case 'txt':
      return buildText(source, options)
  }
}

/** embed 模式下将随 ZIP 打包的附件（已成功读盘并分配 assets/ 路径）。 */
function embeddableAssets(source: ExportSource, options: ExportOptions): ExportAttachment[] {
  if (options.attachmentMode !== 'embed') return []
  if (EXPORT_FORMAT_CAPS[options.format].embedVia !== 'zip') return []
  return [...source.attachments.values()].filter((a) => !a.missing && a.assetPath)
}

function baseFilename(source: ExportSource): string {
  return `${sanitizeFilename(source.title)} ${formatLocalDate(source.exportedAt, source.timezone)}`
}

/** 导出单个会话：返回最终文件（文本文件，或含 assets/ 的 ZIP）。 */
export function exportConversation(
  userId: string,
  conversationId: string,
  rawOptions: ExportOptions,
): Promise<ExportResult> {
  return withExportSlot(async () => {
    const options = normalizeExportOptions(rawOptions)
    const collected = await collectExportSource(userId, conversationId, options, {
      readFiles: options.attachmentMode === 'embed',
      exportedAt: Date.now(),
      embedBudget: newEmbedBudget(),
    })
    if (!collected.ok) return collected
    const source = collected.source
    const caps = EXPORT_FORMAT_CAPS[options.format]

    const text = buildMainText(source, options)
    if (text === null) return { ok: false, code: 'empty_selection' }
    const base = baseFilename(source)
    const mainName = `${base}.${caps.ext}`
    const assets = embeddableAssets(source, options).filter((a) => a.data)

    if (assets.length > 0) {
      const entries: ZipEntry[] = [
        { path: mainName, data: encoder.encode(text) },
        ...assets.map((a) => ({ path: a.assetPath!, data: a.data! })),
      ]
      if (entries.length > ZIP_MAX_ENTRIES) return { ok: false, code: 'too_many_files' }
      return {
        ok: true,
        file: {
          filename: `${base}.zip`,
          mime: 'application/zip',
          data: await buildZip(entries),
          zipEntries: entries.map((e) => ({ name: e.path, size: e.data.length })),
        },
      }
    }

    return {
      ok: true,
      file: { filename: mainName, mime: caps.mime, data: encoder.encode(text), zipEntries: null },
    }
  })
}

/** 预览：不读附件磁盘内容，返回截断的主文件文本与产物结构。 */
export async function previewConversationExport(
  userId: string,
  conversationId: string,
  rawOptions: ExportOptions,
): Promise<ExportPreviewResult> {
  const options = normalizeExportOptions(rawOptions)
  const collected = await collectExportSource(userId, conversationId, options, {
    readFiles: false,
    exportedAt: Date.now(),
    embedBudget: newEmbedBudget(),
  })
  if (!collected.ok) return collected
  const source = collected.source
  const caps = EXPORT_FORMAT_CAPS[options.format]

  const text = buildMainText(source, options)
  if (text === null) return { ok: false, code: 'empty_selection' }
  const base = baseFilename(source)
  const mainName = `${base}.${caps.ext}`
  const assets = embeddableAssets(source, options)
  const isZip = assets.length > 0

  // 按 UTF-16 长度截断（避免为超长文本物化整个码点数组）；截断点落在
  // 代理对中间时回退一位，不劈开字符
  const truncated = text.length > PREVIEW_MAX_CHARS
  let previewEnd = PREVIEW_MAX_CHARS
  if (truncated) {
    const cc = text.charCodeAt(previewEnd - 1)
    if (cc >= 0xd800 && cc <= 0xdbff) previewEnd--
  }

  return {
    ok: true,
    preview: {
      filename: isZip ? `${base}.zip` : mainName,
      kind: isZip ? 'zip' : 'file',
      mime: isZip ? 'application/zip' : caps.mime,
      preview: truncated ? text.slice(0, previewEnd) : text,
      truncated,
      entries: isZip
        ? [
            { name: mainName, size: encoder.encode(text).length },
            ...assets.map((a) => ({ name: a.assetPath!, size: a.byteSize })),
          ]
        : null,
      messageCount: source.messages.length,
    },
  }
}

/**
 * 批量导出：JSONL 合并为单文件（每行一个会话）；其余格式打包 ZIP，
 * 每个会话一个「序号 标题」文件夹（含各自的 assets/）。
 * 不存在 / 无可导出内容的会话跳过；全部失败才报错。
 */
export function exportConversationsBatch(
  userId: string,
  ids: string[],
  rawOptions: ExportOptions,
): Promise<ExportBatchResult> {
  return withExportSlot(async () => {
    const options = normalizeExportOptions(rawOptions)
    const exportedAt = Date.now()
    const caps = EXPORT_FORMAT_CAPS[options.format]

    // 附件字节预算跨全批共享；超限中止整批（静默丢附件比报错更糟）
    const embedBudget = newEmbedBudget()
    const sources: ExportSource[] = []
    for (const id of [...new Set(ids)]) {
      const collected = await collectExportSource(userId, id, options, {
        readFiles: options.attachmentMode === 'embed',
        exportedAt,
        embedBudget,
      })
      if (collected.ok) {
        sources.push(collected.source)
      } else if (collected.code === 'attachments_too_large') {
        return collected
      }
      // not_found / empty_selection 的会话跳过，实际数量经 exportedCount 告知前端
    }
    if (sources.length === 0) return { ok: false, code: 'not_found' }

    const timezone = sources[0]!.timezone
    const date = formatLocalDate(exportedAt, timezone)

    if (options.format === 'jsonl') {
      // 无有效样本的会话（如纯附件 + 不含附件名）不产行，也计入跳过
      const lines = sources
        .map((s) => buildJsonlLine(s, options))
        .filter((l): l is string => l !== null)
      if (lines.length === 0) return { ok: false, code: 'empty_selection' }
      return {
        ok: true,
        exportedCount: lines.length,
        file: {
          filename: `HappyChat 聊天导出 ${date}.jsonl`,
          mime: caps.mime,
          data: encoder.encode(`${lines.join('\n')}\n`),
          zipEntries: null,
        },
      }
    }

    const entries: ZipEntry[] = []
    const pad = String(sources.length).length
    sources.forEach((source, i) => {
      const folder = `${String(i + 1).padStart(Math.max(2, pad), '0')} ${sanitizeFilename(source.title)}`
      // 非 jsonl 格式 buildMainText 不会返回 null，回退空串仅为类型收窄
      const text = buildMainText(source, options) ?? ''
      entries.push({ path: `${folder}/${sanitizeFilename(source.title)}.${caps.ext}`, data: encoder.encode(text) })
      for (const a of embeddableAssets(source, options)) {
        if (a.data) entries.push({ path: `${folder}/${a.assetPath!}`, data: a.data })
      }
    })
    if (entries.length > ZIP_MAX_ENTRIES) return { ok: false, code: 'too_many_files' }

    return {
      ok: true,
      exportedCount: sources.length,
      file: {
        filename: `HappyChat 聊天导出 ${date}.zip`,
        mime: 'application/zip',
        data: await buildZip(entries),
        zipEntries: entries.map((e) => ({ name: e.path, size: e.data.length })),
      },
    }
  })
}
