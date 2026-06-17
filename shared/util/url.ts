/**
 * 拼接上游 Base URL 与路径。Base 末尾通常已是 `/v1`（例如 https://host/llm/v1），
 * 因此必须用「去尾斜杠 + 去头斜杠 + 拼接」而非 new URL(path, base)（后者会丢掉 /v1）。
 */
export function joinBaseUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}`
}
