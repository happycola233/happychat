import type { ExportOptions } from '@shared/schemas/export'
import type { ExportPreviewDTO } from '@shared/types/api'
import { EXPORT_FORMAT_CAPS, normalizeExportOptions } from '@shared/util/exportOptions'
import { buildZip, type ZipEntry } from './archive'
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

export type ExportErrorCode = 'not_found' | 'empty_selection' | 'attachments_too_large'

export type ExportResult = { ok: true; file: BuiltExport } | { ok: false; code: ExportErrorCode }

export type ExportBatchResult =
  | { ok: true; file: BuiltExport; exportedCount: number }
  | { ok: false; code: ExportErrorCode }

export type ExportPreviewResult =
  | { ok: true; preview: ExportPreviewDTO }
  | { ok: false; code: ExportErrorCode }

const encoder = new TextEncoder()

/** 预览文本的最大字符数（弹窗内滚动展示，无需全文）。 */
const PREVIEW_MAX_CHARS = 16_000

function buildMainText(source: ExportSource, options: ExportOptions): string {
  switch (options.format) {
    case 'chatlog-md':
      return buildChatlogMd(source, options)
    case 'markdown':
      return buildMarkdown(source, options)
    case 'html':
      return buildHtml(source, options)
    case 'json':
      return buildJson(source, options)
    case 'jsonl':
      return `${buildJsonlLine(source, options)}\n`
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
export async function exportConversation(
  userId: string,
  conversationId: string,
  rawOptions: ExportOptions,
): Promise<ExportResult> {
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
  const base = baseFilename(source)
  const mainName = `${base}.${caps.ext}`
  const assets = embeddableAssets(source, options).filter((a) => a.data)

  if (assets.length > 0) {
    const entries: ZipEntry[] = [
      { path: mainName, data: encoder.encode(text) },
      ...assets.map((a) => ({ path: a.assetPath!, data: a.data! })),
    ]
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
  const base = baseFilename(source)
  const mainName = `${base}.${caps.ext}`
  const assets = embeddableAssets(source, options)
  const isZip = assets.length > 0

  const chars = [...text]
  const truncated = chars.length > PREVIEW_MAX_CHARS

  return {
    ok: true,
    preview: {
      filename: isZip ? `${base}.zip` : mainName,
      kind: isZip ? 'zip' : 'file',
      mime: isZip ? 'application/zip' : caps.mime,
      preview: truncated ? chars.slice(0, PREVIEW_MAX_CHARS).join('') : text,
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
export async function exportConversationsBatch(
  userId: string,
  ids: string[],
  rawOptions: ExportOptions,
): Promise<ExportBatchResult> {
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
    const lines = sources.map((s) => buildJsonlLine(s, options)).join('\n')
    return {
      ok: true,
      exportedCount: sources.length,
      file: {
        filename: `HappyChat 聊天导出 ${date}.jsonl`,
        mime: caps.mime,
        data: encoder.encode(`${lines}\n`),
        zipEntries: null,
      },
    }
  }

  const entries: ZipEntry[] = []
  const pad = String(sources.length).length
  sources.forEach((source, i) => {
    const folder = `${String(i + 1).padStart(Math.max(2, pad), '0')} ${sanitizeFilename(source.title)}`
    const text = buildMainText(source, options)
    entries.push({ path: `${folder}/${sanitizeFilename(source.title)}.${caps.ext}`, data: encoder.encode(text) })
    for (const a of embeddableAssets(source, options)) {
      if (a.data) entries.push({ path: `${folder}/${a.assetPath!}`, data: a.data })
    }
  })

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
}
