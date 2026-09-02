import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { and, eq, inArray } from 'drizzle-orm'
import type { MessageDTO } from '@shared/types/api'
import type { ExportOptions } from '@shared/schemas/export'
import { processStepsOf } from '@shared/util/processTrack'
import { db } from '../db/client'
import { attachments } from '../db/schema'
import {
  buildPath,
  getConversationMessageDTOs,
  getConversationMessages,
  getOwnedConversation,
  toConversationDTO,
} from '../services/conversations'
import { assignAssetPaths, attachmentRefsOf, textOfContent, type AttachmentRef } from './content'
import { resolveTimezone } from './time'
import type { ExportAttachment, ExportSource } from './types'

/**
 * embed 模式一次导出（含批量累计）允许打包的附件总字节数上限。
 * 全量读盘 + 内存打包的管线必须有硬上限，否则大附件批量导出会耗尽内存、
 * 冻结单进程事件循环（fflate 也不支持 ZIP64，总量超 4GiB 会产出损坏 ZIP）。
 */
export const EXPORT_EMBED_MAX_BYTES = 512 * 1024 * 1024

/** embed 附件字节预算：单会话导出一份，批量导出跨会话共享。 */
export interface EmbedBudget {
  remaining: number
}

export const newEmbedBudget = (): EmbedBudget => ({ remaining: EXPORT_EMBED_MAX_BYTES })

export type CollectResult =
  | { ok: true; source: ExportSource }
  | { ok: false; code: 'not_found' | 'empty_selection' | 'attachments_too_large' }

/**
 * 收集单个会话的导出数据源（归属校验 + 范围/选择过滤 + 附件解析）。
 *
 * options 必须是 normalizeExportOptions 之后的值。readFiles=false 时不读磁盘
 * （预览场景），附件 assetPath 照常分配以保证预览文本与真实导出一致。
 */
export async function collectExportSource(
  userId: string,
  conversationId: string,
  options: ExportOptions,
  {
    readFiles,
    exportedAt,
    embedBudget,
  }: { readFiles: boolean; exportedAt: number; embedBudget: EmbedBudget },
): Promise<CollectResult> {
  const conv = await getOwnedConversation(userId, conversationId)
  if (!conv) return { ok: false, code: 'not_found' }

  const [dtos, rows] = await Promise.all([
    getConversationMessageDTOs(conv.id),
    getConversationMessages(conv.id),
  ])
  const dtoById = new Map(dtos.map((d) => [d.id, d]))

  let messages: MessageDTO[]
  if (options.scope === 'full') {
    messages = dtos
  } else {
    messages = buildPath(rows, conv.activeLeafId)
      .map((m) => dtoById.get(m.id))
      .filter((d): d is MessageDTO => Boolean(d))
  }

  if (options.messageIds?.length) {
    const wanted = new Set(options.messageIds)
    messages = messages.filter((m) => wanted.has(m.id))
  }

  messages = messages.map((message) => ({
    ...message,
    processSteps: processStepsOf(message),
  }))

  // 丢弃仍在流式生成、且没有任何可导出内容的占位助手消息
  messages = messages.filter(
    (m) =>
      m.status !== 'streaming' ||
      textOfContent(m.content).length > 0 ||
      m.processSteps.length > 0 ||
      attachmentRefsOf(m.content).length > 0,
  )

  if (messages.length === 0) return { ok: false, code: 'empty_selection' }

  // scope=full 时计算有效的 activeLeafId：若指向被剔除的流式占位消息，
  // 沿 parentId 回退到最近的存活祖先，避免 JSON 导出留下悬空引用
  let activeLeafId: string | null = null
  if (options.scope === 'full') {
    const kept = new Set(messages.map((m) => m.id))
    let cursor: string | null = conv.activeLeafId
    while (cursor && !kept.has(cursor)) cursor = dtoById.get(cursor)?.parentId ?? null
    activeLeafId = cursor
  }

  const loaded = await loadAttachments(userId, messages, options, readFiles, embedBudget)
  if (!loaded.ok) return loaded
  const attachmentMap = loaded.map

  return {
    ok: true,
    source: {
      conversation: toConversationDTO(conv),
      title: conv.title?.trim() || '未命名聊天',
      messages,
      activeLeafId,
      attachments: attachmentMap,
      exportedAt,
      timezone: resolveTimezone(options.timezone),
    },
  }
}

async function loadAttachments(
  userId: string,
  messages: MessageDTO[],
  options: ExportOptions,
  readFiles: boolean,
  embedBudget: EmbedBudget,
): Promise<
  { ok: true; map: Map<string, ExportAttachment> } | { ok: false; code: 'attachments_too_large' }
> {
  const map = new Map<string, ExportAttachment>()
  if (options.attachmentMode === 'omit') return { ok: true, map }

  const ids: string[] = []
  for (const m of messages) {
    for (const ref of attachmentRefsOf(m.content)) {
      // 分支/分享历史中可能存在空串引用，直接跳过
      if (ref.attachmentId && !map.has(ref.attachmentId)) {
        map.set(ref.attachmentId, placeholder(ref))
        ids.push(ref.attachmentId)
      }
    }
  }
  if (ids.length === 0) return { ok: true, map }

  const rows = await db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.id, ids), eq(attachments.userId, userId)))

  if (options.attachmentMode === 'embed') {
    // 读盘之前先按 DB 记录的字节数扣预算（预览与真实导出同判，保证两者一致失败）
    const total = rows.reduce((sum, r) => sum + r.byteSize, 0)
    if (total > embedBudget.remaining) return { ok: false, code: 'attachments_too_large' }
    embedBudget.remaining -= total
  }

  for (const row of rows) {
    const entry: ExportAttachment = {
      id: row.id,
      kind: row.kind,
      mime: row.mime,
      filename: row.filename,
      byteSize: row.byteSize,
      assetPath: null,
      data: null,
      missing: false,
    }
    if (options.attachmentMode === 'embed') {
      if (readFiles) {
        try {
          // 异步读盘，避免大文件同步 IO 冻结事件循环
          entry.data = new Uint8Array(await readFile(row.storagePath))
        } catch {
          // 磁盘文件缺失：按「仅文件名」降级，不让单个坏附件毁掉整次导出
          entry.missing = true
        }
      } else {
        // 预览不读盘，但仍检查存在性，保证预览文本与真实导出一致
        entry.missing = !existsSync(row.storagePath)
      }
    }
    map.set(row.id, entry)
  }

  if (options.attachmentMode === 'embed') {
    assignAssetPaths([...map.values()].filter((a) => !a.missing))
  }
  return { ok: true, map }
}

/**
 * DB 行不存在的引用占位（构建器按缺失附件降级展示）。
 * kind / 文件名沿用 content 里的引用信息，避免缺失图片被错标成普通文件。
 */
function placeholder(ref: AttachmentRef): ExportAttachment {
  return {
    id: ref.attachmentId,
    kind: ref.kind,
    mime: 'application/octet-stream',
    filename: ref.filenameHint ?? '',
    byteSize: 0,
    assetPath: null,
    data: null,
    missing: true,
  }
}
