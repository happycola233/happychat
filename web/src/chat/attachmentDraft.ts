import type { SendMessageInput } from '@shared/schemas/chat'
import type { AttachmentDTO } from '@shared/types/api'
import type { ContentPart } from '@shared/types/domain'

export interface AttachmentDraftItem {
  draftId: string
  attachmentId: string
  kind: 'image' | 'file'
  filename: string
  byteSize: number | null
  mime: string | null
  detail?: 'auto' | 'low' | 'high'
  retained: boolean
}

export type AttachmentDraftSendRef = NonNullable<SendMessageInput['attachments']>[number]

const RETAINED_IMAGE_FILENAME = '图片'

export function attachmentDraftsFromContent(content: ContentPart[]): AttachmentDraftItem[] {
  return content.flatMap((part, index): AttachmentDraftItem[] => {
    if (part.type === 'input_image') {
      return [
        {
          draftId: `retained-image-${part.attachment_id}-${index}`,
          attachmentId: part.attachment_id,
          kind: 'image',
          filename: RETAINED_IMAGE_FILENAME,
          byteSize: null,
          mime: null,
          detail: part.detail ?? 'auto',
          retained: true,
        },
      ]
    }
    if (part.type === 'input_file') {
      return [
        {
          draftId: `retained-file-${part.attachment_id}-${index}`,
          attachmentId: part.attachment_id,
          kind: 'file',
          filename: part.filename,
          byteSize: part.byte_size ?? null,
          mime: part.mime ?? null,
          retained: true,
        },
      ]
    }
    return []
  })
}

export function attachmentDraftFromAttachment(attachment: AttachmentDTO): AttachmentDraftItem {
  return {
    draftId: attachment.id,
    attachmentId: attachment.id,
    kind: attachment.kind,
    filename: attachment.filename,
    byteSize: attachment.byteSize,
    mime: attachment.mime,
    retained: false,
  }
}

export function attachmentDraftsFromAttachments(
  attachments: AttachmentDTO[],
): AttachmentDraftItem[] {
  return attachments.map(attachmentDraftFromAttachment)
}

export function removeAttachmentDraft(
  attachments: AttachmentDraftItem[],
  draftId: string,
): AttachmentDraftItem[] {
  return attachments.filter((attachment) => attachment.draftId !== draftId)
}

export function toAttachmentRefs(attachments: AttachmentDraftItem[]): AttachmentDraftSendRef[] {
  return attachments.map((attachment) => ({
    attachmentId: attachment.attachmentId,
    kind: attachment.kind,
    filename: attachment.filename,
    detail: attachment.detail,
  }))
}

export function canSubmitAttachmentDraft(
  text: string,
  attachments: AttachmentDraftItem[],
): boolean {
  return text.trim().length > 0 || attachments.length > 0
}

/**
 * 发送请求返回前先上屏的用户消息内容，顺序与服务端写入一致：文字、图片编辑源、其余附件。
 * 服务端可能需要先等文档转 PDF 结束才返回，期间以此展示本次发送的文字与附件。
 */
export function userContentFromDraft(
  text: string,
  attachments: AttachmentDTO[],
  imageSourceIds: string[],
): ContentPart[] {
  const content: ContentPart[] = text.trim() ? [{ type: 'input_text', text }] : []
  const sourceIds = new Set(imageSourceIds)
  for (const attachmentId of imageSourceIds) {
    content.push({ type: 'input_image', attachment_id: attachmentId })
  }
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      if (!sourceIds.has(attachment.id))
        content.push({ type: 'input_image', attachment_id: attachment.id })
      continue
    }
    content.push({
      type: 'input_file',
      attachment_id: attachment.id,
      filename: attachment.filename,
      mime: attachment.mime,
      byte_size: attachment.byteSize,
    })
  }
  return content
}
