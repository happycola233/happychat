import type { MessageDTO } from '@shared/types/api'
import type { ContentPart } from '@shared/types/domain'
import type { ExportOptions } from '@shared/schemas/export'
import { attachmentRefsOf } from './content'
import type { ExportAttachment, ExportSource } from './types'

/** 导出 JSON 里的附件描述。 */
interface JsonAttachment {
  id: string
  kind: 'image' | 'file'
  mime: string
  filename: string
  byteSize: number
  /** embed 模式下在 ZIP 内的相对路径；未嵌入 / 文件缺失时不存在 */
  path?: string
  missing?: true
}

/**
 * 全量结构化导出（happychat-export/1）。
 *
 * scope=full 时 messages 是按创建时间排序的整棵分支树（parentId 可重建树），
 * activeLeafId 保留当前可见分支现场；scope=active 时为根→叶的线性路径。
 */
export function buildJson(source: ExportSource, options: ExportOptions): string {
  const doc = {
    format: 'happychat-export/1',
    exportedAt: source.exportedAt,
    exportedAtIso: new Date(source.exportedAt).toISOString(),
    timezone: source.timezone,
    scope: options.scope,
    conversation: {
      id: source.conversation.id,
      title: source.conversation.title,
      createdAt: source.conversation.createdAt,
      updatedAt: source.conversation.updatedAt,
      // 有效叶子（悬空引用已在收集阶段回退到存活祖先），保证可靠还原分支现场
      ...(options.scope === 'full' ? { activeLeafId: source.activeLeafId } : {}),
    },
    messageCount: source.messages.length,
    messages: source.messages.map((m) => jsonMessage(m, source, options)),
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}

function jsonMessage(
  m: MessageDTO,
  source: ExportSource,
  options: ExportOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: m.id,
    parentId: m.parentId,
    role: m.role,
    status: m.status,
    createdAt: m.createdAt,
    createdAtIso: new Date(m.createdAt).toISOString(),
    content: contentParts(m, options),
  }
  if (options.includeModel) {
    out.modelId = m.modelId
    out.modelLabel = m.modelLabel ?? null
  }
  if (options.includeReasoning) {
    out.reasoningSummary = m.reasoningSummary
    out.reasoningDurationMs = m.reasoningDurationMs
  }
  if (options.includeCitations) out.annotations = m.annotations ?? null
  if (options.includeWebSearch) out.webSearchActions = m.webSearchActions ?? null
  if (options.includeUsage) {
    out.usage = m.usage
    out.generationDurationMs = m.generationDurationMs
  }
  if (m.errorMessage) out.errorMessage = m.errorMessage

  if (options.attachmentMode !== 'omit') {
    const attachments = attachmentRefsOf(m.content)
      .map((ref) => (ref.attachmentId ? source.attachments.get(ref.attachmentId) : undefined))
      .filter((a): a is ExportAttachment => Boolean(a))
      .map((a) => jsonAttachment(a, options))
    if (attachments.length > 0) out.attachments = attachments
  }
  return out
}

/** 按选项过滤 content：omit 模式剥掉附件部件；citations 关闭时剥掉 part 级注释。 */
function contentParts(m: MessageDTO, options: ExportOptions): ContentPart[] {
  let parts = m.content
  if (options.attachmentMode === 'omit') {
    parts = parts.filter(
      (p) => p.type === 'input_text' || p.type === 'output_text',
    )
  }
  if (!options.includeCitations) {
    parts = parts.map((p) =>
      p.type === 'output_text' && p.annotations ? { ...p, annotations: undefined } : p,
    )
  }
  return parts
}

function jsonAttachment(a: ExportAttachment, options: ExportOptions): JsonAttachment {
  const out: JsonAttachment = {
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    filename: a.filename,
    byteSize: a.byteSize,
  }
  if (a.missing) out.missing = true
  if (options.attachmentMode === 'embed' && a.assetPath && !a.missing) out.path = a.assetPath
  return out
}
