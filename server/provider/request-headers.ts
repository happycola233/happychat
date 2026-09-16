import type { ProviderProtocol } from '@shared/types/domain'

/** 与 fetch 一样按大小写不敏感的名称合并；自定义鉴权/版本头可以覆盖协议默认值。 */
export function buildProviderHeaders(
  protocol: ProviderProtocol,
  apiKey: string,
  extraHeaders: Record<string, string> = {},
  json = false,
): Record<string, string> {
  const headers = new Headers(
    protocol === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` },
  )
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value)
  if (json) headers.set('Content-Type', 'application/json')
  return Object.fromEntries(headers.entries())
}
