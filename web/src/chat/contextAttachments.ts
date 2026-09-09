import type { ConversationAttachmentDTO, MessageDTO } from '@shared/types/api'
import type { ContextAttachmentSelection, ContextPolicy } from '@shared/types/context'
import {
  isContextAttachment,
  selectContext,
  type ContextAttachmentPart,
} from '@shared/util/contextPolicy'

export interface ContextAttachmentItem {
  id: string
  part: ContextAttachmentPart
  messageId: string
  groupId: string
  turn: number
  createdAt: number
  prompt: string
  source: 'uploads' | 'generatedImages'
  currentBranch: boolean
  filename: string
  metadata?: ConversationAttachmentDTO
}

/** 同一附件可能被编辑重发复用。清单只列一次，优先显示原始生成来源及当前分支引用。 */
export function contextAttachmentCatalog(
  allMessages: readonly MessageDTO[],
  path: readonly MessageDTO[],
  metadata: readonly ConversationAttachmentDTO[],
): ContextAttachmentItem[] {
  const currentIds = new Set(path.map((message) => message.id))
  const byId = new Map(allMessages.map((message) => [message.id, message]))
  const metadataById = new Map(metadata.map((attachment) => [attachment.id, attachment]))
  const turns = new Map<string, number>()
  let turn = 0
  for (const message of path) {
    if (message.role === 'user') turn++
    turns.set(message.id, turn)
  }
  const catalog = new Map<string, ContextAttachmentItem>()
  // 当前分支先入表，其他分支中重复引用的文件不会抢走归属。
  for (const message of [...path, ...allMessages.filter((item) => !currentIds.has(item.id))]) {
    let userMessage = message
    while (userMessage.role !== 'user' && userMessage.parentId && byId.has(userMessage.parentId)) {
      userMessage = byId.get(userMessage.parentId)!
    }
    const prompt = userMessage.content
      .flatMap((part) => (part.type === 'input_text' ? [part.text] : []))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const parts = message.content.filter(isContextAttachment)
    parts.forEach((part, index) => {
      const existing = catalog.get(part.attachment_id)
      if (existing) {
        if (part.type === 'image_result') existing.source = 'generatedImages'
        return
      }
      const meta = metadataById.get(part.attachment_id)
      catalog.set(part.attachment_id, {
        id: part.attachment_id,
        part,
        messageId: message.id,
        groupId: `${currentIds.has(message.id) ? 'current' : 'other'}:${userMessage.id}`,
        turn: turns.get(message.id) ?? 0,
        createdAt: message.createdAt,
        prompt,
        source: part.type === 'image_result' ? 'generatedImages' : 'uploads',
        currentBranch: currentIds.has(message.id),
        filename:
          meta?.filename ??
          (part.type === 'input_file'
            ? part.filename
            : `${part.type === 'image_result' ? '生成图' : '上传图片'} ${index + 1}`),
        metadata: meta,
      })
    })
  }
  return [...catalog.values()].sort(
    (a, b) => Number(b.currentBranch) - Number(a.currentBranch) || b.createdAt - a.createdAt,
  )
}

export function selectedContextAttachmentIds(
  path: readonly MessageDTO[],
  policy: ContextPolicy,
  selection: ContextAttachmentSelection,
  allMessages: readonly MessageDTO[],
  imageModel = false,
): Set<string> {
  const result = selectContext(
    path,
    imageModel ? { ...policy, historyTurns: 0 } : policy,
    -1,
    selection,
    allMessages,
  )
  return new Set(
    [
      ...result.messages.flatMap((message) => message.content.filter(isContextAttachment)),
      ...result.extraAttachments,
    ].map((part) => part.attachment_id),
  )
}

/** 明确记录用户的选择意图，即使之后改动规则，也不会悄悄覆盖手动勾选。 */
export function setContextAttachmentSelection(
  current: ContextAttachmentSelection,
  ids: readonly string[],
  checked: boolean,
): ContextAttachmentSelection {
  const include = new Set(current.include)
  const exclude = new Set(current.exclude)
  for (const id of ids) {
    if (checked) {
      include.add(id)
      exclude.delete(id)
    } else {
      exclude.add(id)
      include.delete(id)
    }
  }
  return { include: [...include], exclude: [...exclude] }
}
