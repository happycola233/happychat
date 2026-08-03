/**
 * 拼接上游 Base URL 与路径。Base 末尾通常已是 `/v1`（例如 https://host/llm/v1），
 * 因此必须用「去尾斜杠 + 去头斜杠 + 拼接」而非 new URL(path, base)（后者会丢掉 /v1）。
 */
export function joinBaseUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}`
}

/**
 * Anthropic 的 Base URL 同时兼容官方根地址（`https://api.anthropic.com`）与已经包含
 * `/v1` 的网关地址，避免生成重复的 `/v1/v1`。
 */
export function joinAnthropicUrl(base: string, versionedPath: `/v1/${string}`): string {
  const normalizedBase = base.replace(/\/+$/, '')
  const path = /\/v1$/i.test(normalizedBase) ? versionedPath.slice(3) : versionedPath
  return joinBaseUrl(normalizedBase, path)
}

/** 将不可信上游 URL 收敛为可安全点击的绝对网页地址。 */
export function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}
