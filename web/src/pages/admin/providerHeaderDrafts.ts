import { providerHeadersSchema } from '@shared/schemas/provider-headers'
import { createRandomUuid } from '../../lib/randomUuid'

export interface HeaderDraft {
  id: string
  name: string
  value: string
}

export function createHeaderDrafts(headers: Record<string, string>): HeaderDraft[] {
  return Object.entries(headers).map(([name, value]) => ({ id: createRandomUuid(), name, value }))
}

export function parseHeaderDrafts(drafts: HeaderDraft[]): Record<string, string> {
  const entries: [string, string][] = []
  const seen = new Set<string>()
  for (const draft of drafts) {
    const name = draft.name.trim()
    if (!name) throw new Error('请填写每一行的请求头名称，或移除空行')
    if (seen.has(name.toLowerCase())) throw new Error(`请求头「${name}」重复（名称不区分大小写）`)
    seen.add(name.toLowerCase())
    entries.push([name, draft.value])
  }
  const parsed = providerHeadersSchema.safeParse(Object.fromEntries(entries))
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '请求头配置不正确')
  return parsed.data
}
