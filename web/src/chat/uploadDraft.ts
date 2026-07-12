import type { AttachmentDTO } from '@shared/types/api'

/**
 * 待发送上传项的状态机：文件选中即刻以 uploading 上屏，
 * 完成后原地转为 done（保留本地预览避免闪烁），失败转 error 供重试/移除。
 */
export type UploadDraftStatus = 'uploading' | 'done' | 'error'

export interface UploadDraftItem {
  /** 本地 ID（上传尚未完成时没有服务端 ID，全生命周期用它索引）。 */
  localId: string
  kind: 'image' | 'file'
  filename: string
  byteSize: number
  mime: string
  /** 图片的本地 object URL 预览；非图片为 null。选中即有，无需等上传完成。 */
  previewUrl: string | null
  status: UploadDraftStatus
  /** 上传进度 ∈ [0, 1]；done 恒为 1。 */
  progress: number
  /** 上传完成后的服务端附件；uploading/error 为 null。 */
  attachment: AttachmentDTO | null
  errorMessage: string | null
}

export function createUploadDraft(input: {
  localId: string
  file: File
  previewUrl: string | null
}): UploadDraftItem {
  return {
    localId: input.localId,
    kind: input.file.type.startsWith('image/') ? 'image' : 'file',
    filename: input.file.name,
    byteSize: input.file.size,
    mime: input.file.type,
    previewUrl: input.previewUrl,
    status: 'uploading',
    progress: 0,
    attachment: null,
    errorMessage: null,
  }
}

function patchUploadDraft(
  items: UploadDraftItem[],
  localId: string,
  patch: (item: UploadDraftItem) => UploadDraftItem,
): UploadDraftItem[] {
  return items.map((item) => (item.localId === localId ? patch(item) : item))
}

export function setUploadDraftProgress(
  items: UploadDraftItem[],
  localId: string,
  progress: number,
): UploadDraftItem[] {
  return patchUploadDraft(items, localId, (item) =>
    // 只有在途项接受进度（完成/失败后迟到的进度事件不回退状态）。
    item.status === 'uploading'
      ? { ...item, progress: Math.min(1, Math.max(item.progress, progress)) }
      : item,
  )
}

export function finishUploadDraft(
  items: UploadDraftItem[],
  localId: string,
  attachment: AttachmentDTO,
): UploadDraftItem[] {
  return patchUploadDraft(items, localId, (item) => ({
    ...item,
    status: 'done',
    progress: 1,
    attachment,
    errorMessage: null,
  }))
}

export function failUploadDraft(
  items: UploadDraftItem[],
  localId: string,
  errorMessage: string,
): UploadDraftItem[] {
  return patchUploadDraft(items, localId, (item) => ({
    ...item,
    status: 'error',
    attachment: null,
    errorMessage,
  }))
}

/** 重试：失败项回到 uploading 起点；其他状态原样返回。 */
export function restartUploadDraft(items: UploadDraftItem[], localId: string): UploadDraftItem[] {
  return patchUploadDraft(items, localId, (item) =>
    item.status === 'error'
      ? { ...item, status: 'uploading', progress: 0, errorMessage: null }
      : item,
  )
}

export function removeUploadDraft(items: UploadDraftItem[], localId: string): UploadDraftItem[] {
  return items.filter((item) => item.localId !== localId)
}

/** 已就绪可随消息发送的服务端附件（保持上屏顺序）。 */
export function completedUploadAttachments(items: UploadDraftItem[]): AttachmentDTO[] {
  return items.flatMap((item) => (item.attachment ? [item.attachment] : []))
}

export function hasActiveUpload(items: UploadDraftItem[]): boolean {
  return items.some((item) => item.status === 'uploading')
}

export function hasFailedUpload(items: UploadDraftItem[]): boolean {
  return items.some((item) => item.status === 'error')
}

/** 附件卡片的容量文案，如 `3.2 MB`；非法输入返回空串。 */
export function formatByteSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB'] as const
  let value = bytes
  let unit: string = 'B'
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  const rounded = value >= 100 ? Math.round(value).toString() : value.toFixed(1)
  return `${rounded.replace(/\.0$/, '')} ${unit}`
}

/** 文件卡片的类型徽标：优先扩展名（大写），无扩展名时退回 MIME 子类型或「文件」。 */
export function fileTypeLabel(filename: string, mime: string | null): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1]
  if (ext) return ext.toUpperCase()
  const subtype = mime?.split('/')[1]
  if (subtype) return subtype.slice(0, 8).toUpperCase()
  return '文件'
}
