import type { ApiError } from '@shared/types/api'

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
    throw new ApiRequestError(err?.message ?? '请求失败，请稍后重试', res.status, err?.code)
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

/** 上传 multipart 表单（不设置 Content-Type，由浏览器自动带 boundary）。 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: formData })
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = (data as ApiError | null)?.error
    throw new ApiRequestError(err?.message ?? '上传失败', res.status, err?.code)
  }
  return data as T
}
