import type { MessageDTO } from '@shared/types/api'

/** 客户端按 activeLeafId 沿 parentId 构建可见分支路径（根 → 叶）。 */
export function buildPath(messages: MessageDTO[], leafId: string | null): MessageDTO[] {
  if (!leafId) return []
  const byId = new Map(messages.map((m) => [m.id, m]))
  const path: MessageDTO[] = []
  const seen = new Set<string>()
  let cur = byId.get(leafId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.push(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return path.reverse()
}

/** 计算某节点的兄弟节点（同 parentId、同 role），用于分支切换。 */
export function getSiblings(messages: MessageDTO[], node: MessageDTO): MessageDTO[] {
  return messages
    .filter((m) => m.parentId === node.parentId && m.role === node.role)
    .sort((a, b) => a.createdAt - b.createdAt)
}
