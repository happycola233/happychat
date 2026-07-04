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

export interface AttachmentDraftSupport {
  canImage: boolean
  canFile: boolean
}

export type AttachmentDraftSupportIssue = 'image' | 'file' | null

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
          byteSize: null,
          mime: null,
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

export function toAttachmentRefs(
  attachments: AttachmentDraftItem[],
): AttachmentDraftSendRef[] {
  return attachments.map((attachment) => ({
    attachmentId: attachment.attachmentId,
    kind: attachment.kind,
    filename: attachment.filename,
    detail: attachment.detail,
  }))
}

export function canSubmitAttachmentDraft(text: string, attachments: AttachmentDraftItem[]): boolean {
  return text.trim().length > 0 || attachments.length > 0
}

export function getAttachmentDraftSupportIssue(
  attachments: AttachmentDraftItem[],
  support: AttachmentDraftSupport,
): AttachmentDraftSupportIssue {
  if (attachments.some((attachment) => attachment.kind === 'image') && !support.canImage) {
    return 'image'
  }
  if (attachments.some((attachment) => attachment.kind === 'file') && !support.canFile) {
    return 'file'
  }
  return null
}
