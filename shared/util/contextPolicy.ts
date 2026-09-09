import type { ContentPart, Role } from '../types/domain'
import type {
  AttachmentRetention,
  ContextAttachmentSelection,
  ContextPolicy,
} from '../types/context'

/** 升级后保持已有聊天的携带方式；12 是初始偏好，不再是硬上限。 */
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  historyTurns: null,
  uploads: { mode: 'all' },
  generatedImages: { mode: 'items', limit: 12 },
}

export interface ContextMessage {
  role: Role
  content: ContentPart[]
}

export interface ContextCounts {
  turns: number
  uploads: number
  generatedImages: number
}

export type ContextAttachmentPart = Extract<
  ContentPart,
  { type: 'input_image' | 'input_file' | 'image_result' }
>

export const EMPTY_CONTEXT_SELECTION: ContextAttachmentSelection = { include: [], exclude: [] }

export function isContextAttachment(part: ContentPart): part is ContextAttachmentPart {
  return part.type === 'input_image' || part.type === 'input_file' || part.type === 'image_result'
}

export function contextAttachmentKind(part: ContentPart): 'uploads' | 'generatedImages' | null {
  if (part.type === 'input_image' || part.type === 'input_file') return 'uploads'
  return part.type === 'image_result' ? 'generatedImages' : null
}

/**
 * 前端预览与服务端请求共用的选择器。只处理引用，不读文件，也不修改聊天记录。
 * currentUserMessageIndex 指明本次提问（包括编辑重发 / 重新生成的原提问），其附件不裁剪。
 * 未传该索引时，所有消息视为历史，供「下一次发送」预览使用。
 */
export function selectContext<T extends ContextMessage>(
  messages: readonly T[],
  policy: ContextPolicy,
  currentUserMessageIndex = -1,
  selection: ContextAttachmentSelection = EMPTY_CONTEXT_SELECTION,
  availableMessages: readonly ContextMessage[] = messages,
): {
  messages: T[]
  extraAttachments: ContextAttachmentPart[]
  total: ContextCounts
  retained: ContextCounts
} {
  let turn = -1
  const turnByMessage = messages.map((message) => {
    if (message.role === 'user') turn++
    return turn
  })
  const historicalTurns = turnByMessage.filter(
    (_, index) => messages[index]!.role === 'user' && index !== currentUserMessageIndex,
  )
  const firstRetainedTurn =
    policy.historyTurns === null ? -1 : (historicalTurns.slice(-policy.historyTurns)[0] ?? turn + 1)
  const keepMessage = messages.map(
    (_, index) =>
      index === currentUserMessageIndex ||
      (policy.historyTurns !== 0 && turnByMessage[index]! >= firstRetainedTurn),
  )

  const keepPart = messages.map((message) => message.content.map(() => false))
  for (const kind of ['uploads', 'generatedImages'] as const) {
    const retention = policy[kind]
    const selectedTurns = new Set<number>()
    const seenIds = new Set<string>()
    let count = 0
    for (let index = messages.length - 1; index >= 0; index--) {
      if (!keepMessage[index]) continue
      const message = messages[index]!
      for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex--) {
        const part = message.content[partIndex]!
        if (!isContextAttachment(part) || contextAttachmentKind(part) !== kind) continue
        if (seenIds.has(part.attachment_id)) continue
        seenIds.add(part.attachment_id)
        const current = index === currentUserMessageIndex
        const selected =
          current ||
          retention.mode === 'all' ||
          (retention.mode === 'items' && count < retention.limit) ||
          (retention.mode === 'rounds' &&
            (selectedTurns.has(turnByMessage[index]!) || selectedTurns.size < retention.limit))
        keepPart[index]![partIndex] = selected
        if (selected && !current) {
          count++
          selectedTurns.add(turnByMessage[index]!)
        }
      }
    }
  }

  const manuallyIncluded = new Set(selection.include)
  const manuallyExcluded = new Set(selection.exclude)
  messages.forEach((message, index) => {
    if (index === currentUserMessageIndex) return
    message.content.forEach((part, partIndex) => {
      if (!isContextAttachment(part)) return
      if (manuallyIncluded.has(part.attachment_id)) keepPart[index]![partIndex] = true
      if (manuallyExcluded.has(part.attachment_id)) keepPart[index]![partIndex] = false
    })
  })

  // 同一文件在分支上可能被重复引用。只发送最后一次选中的引用，本次附件优先。
  const sentIds = new Set<string>()
  for (let index = messages.length - 1; index >= 0; index--) {
    if (!keepMessage[index]) continue
    messages[index]!.content.forEach((part, partIndex) => {
      if (!isContextAttachment(part) || !keepPart[index]![partIndex]) return
      if (sentIds.has(part.attachment_id)) keepPart[index]![partIndex] = false
      sentIds.add(part.attachment_id)
    })
  }

  const total: ContextCounts = { turns: historicalTurns.length, uploads: 0, generatedImages: 0 }
  const retained: ContextCounts = { turns: 0, uploads: 0, generatedImages: 0 }
  const selectedMessages: T[] = []
  messages.forEach((message, index) => {
    const current = index === currentUserMessageIndex
    if (!current && keepMessage[index] && message.role === 'user') retained.turns++
    let omitted = 0
    const content = message.content.filter((part, partIndex) => {
      const kind = contextAttachmentKind(part)
      if (!kind) return true
      if (!current) total[kind]++
      if (keepMessage[index] && keepPart[index]![partIndex]) {
        if (!current) retained[kind]++
        return true
      }
      omitted++
      return false
    })
    if (!keepMessage[index]) return
    // 图片独占的消息也留下简短文字，避免模型把「这几张」误认为仍有图片可见。
    if (omitted > 0) {
      const text = `[此前${message.role === 'assistant' ? '生成的图片' : '上传的附件'}有 ${omitted} 个未随本次请求发送]`
      content.push(
        message.role === 'assistant' ? { type: 'output_text', text } : { type: 'input_text', text },
      )
    }
    selectedMessages.push({ ...message, content })
  })
  // 手动选中的旧轮次 / 其他分支附件可单独加入本次请求，不恢复那一分支的文字或私有上下文。
  const extraAttachments: ContextAttachmentPart[] = []
  for (const message of availableMessages) {
    for (const part of message.content) {
      if (
        !isContextAttachment(part) ||
        !manuallyIncluded.has(part.attachment_id) ||
        sentIds.has(part.attachment_id)
      )
        continue
      extraAttachments.push(part)
      sentIds.add(part.attachment_id)
      retained[part.type === 'image_result' ? 'generatedImages' : 'uploads']++
    }
  }
  return { messages: selectedMessages, extraAttachments, total, retained }
}

/** 人工选中的历史附件作为本次提问的附加引用，只修改请求副本。 */
export function withExtraContextAttachments<T extends ContextMessage>(
  messages: T[],
  extra: ContextAttachmentPart[],
): T[] {
  if (extra.length === 0) return messages
  return messages.map((message, index) =>
    index !== messages.length - 1
      ? message
      : {
          ...message,
          content: [
            ...message.content,
            {
              type: 'input_text',
              text: '[以下附件由用户为本次提问从聊天历史中另行选取]',
            } as ContentPart,
            ...extra.map(
              (part): ContentPart =>
                part.type === 'image_result'
                  ? { type: 'input_image', attachment_id: part.attachment_id }
                  : part,
            ),
          ],
        },
  )
}

export function retentionLabel(retention: AttachmentRetention, unit: string): string {
  if (retention.mode === 'all') return '全部'
  if (retention.mode === 'none') return '不携带'
  return `最近 ${retention.limit} ${retention.mode === 'rounds' ? '轮' : unit}`
}

export function contextPolicyLabel(policy: ContextPolicy): string {
  const history = policy.historyTurns === null ? '全部记录' : `历史 ${policy.historyTurns} 轮`
  return `${history} · 上传${retentionLabel(policy.uploads, '个')} · 生成图${retentionLabel(policy.generatedImages, '张')}`
}
