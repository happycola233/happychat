import type { ModelKind } from '@shared/types/domain'
import {
  isImageMime,
  isOfficePdfSource,
  isSupportedFileInputMime,
  uploadMime,
} from '@shared/util/fileTypes'

export interface AttachmentInputSupport {
  canImage?: boolean
  canFile?: boolean
  modelKind?: ModelKind
  /**
   * 开启「Word 与 PowerPoint 转为 PDF」后，这些文件上传后在服务端后台转为 PDF，
   * 草稿里可能仍是原格式，上传和发送前都按 PDF 放行；服务端发送时等待转换结束并按最终格式复核，
   * 转换失败而保留原格式的文件仍会被拦下。
   */
  convertsOfficeToPdf?: boolean
}

export interface AttachmentInput {
  filename: string
  mime: string | null
  kind?: 'image' | 'file'
}

/** 上传和发送前共用同一判断；切换模型后保留草稿，由用户移除附件或切回模型。 */
export function attachmentInputError(
  attachment: AttachmentInput,
  { canImage, canFile, modelKind, convertsOfficeToPdf }: AttachmentInputSupport,
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
  if (
    modelKind === 'anthropic' &&
    !isSupportedFileInputMime(mime, modelKind) &&
    !(convertsOfficeToPdf && isOfficePdfSource(mime))
  ) {
    return `当前模型仅支持 PDF 与纯文本文件，请转换格式或切换模型：${attachment.filename}`
  }
  if (!mime) return `文件格式不支持：${attachment.filename}`
  return null
}
