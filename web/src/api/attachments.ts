import type { AttachmentDTO } from '@shared/types/api'
import { apiUpload } from './client'

export const uploadAttachment = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return apiUpload<{ attachment: AttachmentDTO }>('/attachments', fd).then((r) => r.attachment)
}

export const attachmentUrl = (id: string) => `/api/attachments/${id}`
