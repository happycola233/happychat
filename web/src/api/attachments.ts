import type { ApiError, AttachmentDTO } from '@shared/types/api'
import { ApiRequestError } from './client'

export interface UploadAttachmentOptions {
  /** 上传进度回调，fraction ∈ [0, 1]（总大小不可知时不会触发）。 */
  onProgress?: (fraction: number) => void
  /** 取消上传：abort 后 Promise 以 DOMException('AbortError') 拒绝。 */
  signal?: AbortSignal
}

/** 判断错误是否来自主动取消（调用方据此静默处理，不当作失败提示）。 */
export function isUploadAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * 上传附件。用 XMLHttpRequest 而非 fetch：浏览器目前只有 XHR 能拿到请求体的
 * 上传进度事件（fetch 的 duplex 流式请求兼容性不足），错误语义与 apiUpload 对齐。
 */
export function uploadAttachment(
  file: File,
  { onProgress, signal }: UploadAttachmentOptions = {},
): Promise<AttachmentDTO> {
  return new Promise<AttachmentDTO>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('上传已取消', 'AbortError'))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/attachments')
    xhr.withCredentials = true
    xhr.responseType = 'text'

    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => signal?.removeEventListener('abort', onAbort)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      cleanup()
      let data: unknown = null
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        // 非 JSON 响应（如网关错误页）按下方状态码兜底处理。
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const attachment = (data as { attachment?: AttachmentDTO } | null)?.attachment
        if (attachment) {
          resolve(attachment)
          return
        }
      }
      const err = (data as ApiError | null)?.error
      reject(new ApiRequestError(err?.message ?? '上传失败', xhr.status, err?.code))
    }
    xhr.onerror = () => {
      cleanup()
      reject(new ApiRequestError('上传失败，请检查网络后重试', 0))
    }
    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('上传已取消', 'AbortError'))
    }

    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

export const attachmentUrl = (id: string) => `/api/attachments/${id}`
