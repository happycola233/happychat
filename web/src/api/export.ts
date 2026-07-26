import type { ExportPreviewDTO } from '@shared/types/api'
import type { ExportOptions } from '@shared/schemas/export'
import { apiPost, apiPostFile } from './client'

/** 导出预览（弹窗实时展示主文件文本与产物结构）。 */
export const previewConversationExport = (conversationId: string, options: ExportOptions) =>
  apiPost<{ preview: ExportPreviewDTO }>(`/conversations/${conversationId}/export`, {
    ...options,
    preview: true,
  }).then((r) => r.preview)

/** 下载单个会话的导出文件。 */
export const downloadConversationExport = (conversationId: string, options: ExportOptions) =>
  apiPostFile(`/conversations/${conversationId}/export`, options)

/** 批量导出（ZIP / JSONL 单文件）。 */
export const downloadBatchExport = (ids: string[], options: ExportOptions) =>
  apiPostFile('/conversations/export-batch', { ids, ...options })

/** 把 Blob 存为本地文件（临时 URL + a[download]）。 */
export function saveBlobToFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 延迟释放，避免部分浏览器在下载开始前回收 URL
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
