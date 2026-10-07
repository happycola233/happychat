import type { ModelKind } from '@shared/types/domain'
import { isImageMime, isSupportedFileInputMime, uploadMime } from '@shared/util/fileTypes'

export interface AttachmentInputSupport {
  canImage?: boolean
  canFile?: boolean
  modelKind?: ModelKind
}

interface AttachmentInput {
  filename: string
  mime: string | null
  kind?: 'image' | 'file'
}

/** 上传和发送前共用同一判断；切换模型后保留草稿，由用户移除附件或切回模型。 */
export function attachmentInputError(
  attachment: AttachmentInput,
  { canImage, canFile, modelKind }: AttachmentInputSupport,
): string | null {
  const mime = uploadMime(attachment.filename, attachment.mime ?? '')
  const isImage =
    attachment.kind === 'image' || isImageMime(mime ?? '') || attachment.mime?.startsWith('image/')
  if (isImage) {
    if (!canImage) return '当前模型不支持图片输入，请移除图片或切换模型'
    // 历史图片引用可能没有 MIME；它们已在首次上传和服务端发送边界校验。
    if (attachment.kind === 'image' && !attachment.mime) return null
    return mime && isImageMime(mime) ? null : '图片格式不支持，请使用 PNG、JPEG、GIF 或 WebP'
  }
  if (!canFile) return '当前模型不支持文件输入，请移除文件或切换模型'
  if (modelKind === 'anthropic' && !isSupportedFileInputMime(mime, modelKind)) {
    return `当前模型仅支持 PDF 与纯文本文件，请转换格式或切换模型：${attachment.filename}`
  }
  if (!mime) return `文件格式不支持：${attachment.filename}`
  return null
}
