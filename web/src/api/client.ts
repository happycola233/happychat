import type { ApiError } from '@shared/types/api'
import { MAINTENANCE_ERROR_CODE } from '@shared/schemas/maintenance'

/** 带状态码与错误码的请求异常，便于上层据 code/status 给出友好中文提示。 */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

const maintenanceRejectionListeners = new Set<() => void>()

/**
 * 订阅「请求被维护模式拦下」，返回取消订阅函数。
 * 请求层不依赖页面状态，由 MaintenanceGate 订阅后刷新维护状态、切换到维护页。
 */
export function onMaintenanceRejection(listener: () => void): () => void {
  maintenanceRejectionListeners.add(listener)
  return () => maintenanceRejectionListeners.delete(listener)
}

/** 构造请求异常；被维护模式拦下时通知订阅者。 */
function toRequestError(message: string, status: number, code?: string): ApiRequestError {
  if (code === MAINTENANCE_ERROR_CODE) {
    maintenanceRejectionListeners.forEach((listener) => listener())
  }
  return new ApiRequestError(message, status, code)
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = (data as ApiError | null)?.error
    throw toRequestError(err?.message ?? '请求失败，请稍后重试', res.status, err?.code)
  }
  return data as T
}

export const apiGet = <T>(path: string) => apiFetch<T>(path)

export const apiPost = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

export const apiPut = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

export const apiPatch = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

export const apiDelete = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'DELETE',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

/** 从 Content-Disposition 解析文件名（优先 RFC 5987 的 filename*）。 */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      // 编码异常时回退 filename=
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header)
  return plain?.[1] ?? null
}

/** POST 并接收文件流（导出下载用）。失败时响应体仍是 JSON ApiError。 */
export async function apiPostFile(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string | null; exportedCount: number | null }> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
  if (!res.ok) {
    let message = '请求失败，请稍后重试'
    let code: string | undefined
    try {
      const data = (await res.json()) as ApiError
      message = data.error?.message ?? message
      code = data.error?.code
    } catch {
      // 非 JSON 错误体，保留默认文案
    }
    throw toRequestError(message, res.status, code)
  }
  const countHeader = res.headers.get('X-Exported-Count')
  const exportedCount = countHeader !== null ? Number.parseInt(countHeader, 10) : NaN
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get('Content-Disposition')),
    // 批量导出会携带实际导出数（被删除的会话会被服务端跳过）
    exportedCount: Number.isNaN(exportedCount) ? null : exportedCount,
  }
}

/** 上传 multipart 表单（不设置 Content-Type，由浏览器自动带 boundary）。 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: formData })
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = (data as ApiError | null)?.error
    throw toRequestError(err?.message ?? '上传失败', res.status, err?.code)
  }
  return data as T
}
