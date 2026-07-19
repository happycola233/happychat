/**
 * 分享消息选择的分支一致性校验。
 *
 * 约束：用户可在「一条 root→leaf 分支路径」上任意勾选消息（用户/助手解耦，不强制成对），
 * 但选中集必须完整落在同一条祖先链上——不允许两个并列分支各选一条，否则上下文顺序会紊乱。
 */

export interface SelectionNode {
  id: string
  parentId: string | null
}

/**
 * 校验选中集合并解析出快照顺序。
 *
 * 实现：以「最深的选中节点」为基准，沿 parentId 回溯出它的完整祖先链；
 * 当且仅当所有选中节点都在这条链上时选择合法。返回按链序（根 → 叶）排列的选中 id，
 * 非法（空选、id 不存在、跨并列分支、环）返回 null。
 */
export function resolveSelectionChain(
  nodes: SelectionNode[],
  selectedIds: string[],
): string[] | null {
  if (selectedIds.length === 0) return null
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const selected = new Set(selectedIds)
  if (selected.size !== selectedIds.length) return null
  for (const id of selected) if (!byId.has(id)) return null

  // 各选中节点的深度（root=0）；带环保护。
  const depthOf = (id: string): number | null => {
    let depth = 0
    const seen = new Set<string>()
    let cur = byId.get(id)
    while (cur) {
      if (seen.has(cur.id)) return null
      seen.add(cur.id)
      if (!cur.parentId) return depth
      cur = byId.get(cur.parentId)
      depth++
    }
    // parentId 悬空（不在集合内）时按到达处截断，仍可作为相对深度使用。
    return depth
  }

  let deepestId: string | null = null
  let deepestDepth = -1
  for (const id of selected) {
    const d = depthOf(id)
    if (d === null) return null
    if (d > deepestDepth) {
      deepestDepth = d
      deepestId = id
    }
  }
  if (!deepestId) return null

  // 最深节点的祖先链（根 → 叶）。
  const chain: string[] = []
  const seen = new Set<string>()
  let cur = byId.get(deepestId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.push(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  chain.reverse()

  const chainSet = new Set(chain)
  for (const id of selected) if (!chainSet.has(id)) return null

  return chain.filter((id) => selected.has(id))
}
