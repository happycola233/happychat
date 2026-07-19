import { describe, expect, it } from 'vitest'
import { resolveSelectionChain, type SelectionNode } from './shareSelection'

/**
 * 树形结构（u=用户消息，a=助手消息）：
 *
 *   u1 ── a1 ── u2 ── a2        （主分支）
 *          └── u2b ── a2b       （编辑重发形成的并列分支）
 */
const nodes: SelectionNode[] = [
  { id: 'u1', parentId: null },
  { id: 'a1', parentId: 'u1' },
  { id: 'u2', parentId: 'a1' },
  { id: 'a2', parentId: 'u2' },
  { id: 'u2b', parentId: 'a1' },
  { id: 'a2b', parentId: 'u2b' },
]

describe('resolveSelectionChain', () => {
  it('同一分支上的任意子集合法，且按链序（根→叶）返回', () => {
    expect(resolveSelectionChain(nodes, ['a2', 'u1'])).toEqual(['u1', 'a2'])
    expect(resolveSelectionChain(nodes, ['u2', 'a1', 'u1', 'a2'])).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('用户/助手可解耦选择（不强制成对）', () => {
    expect(resolveSelectionChain(nodes, ['a1', 'a2'])).toEqual(['a1', 'a2'])
    expect(resolveSelectionChain(nodes, ['u1', 'u2'])).toEqual(['u1', 'u2'])
  })

  it('并列分支的旁支消息也可作为链（走 u2b 分支）', () => {
    expect(resolveSelectionChain(nodes, ['u1', 'a2b'])).toEqual(['u1', 'a2b'])
  })

  it('跨两条并列分支选择非法', () => {
    expect(resolveSelectionChain(nodes, ['u2', 'u2b'])).toBeNull()
    expect(resolveSelectionChain(nodes, ['a2', 'a2b'])).toBeNull()
    expect(resolveSelectionChain(nodes, ['u1', 'u2', 'a2b'])).toBeNull()
  })

  it('空选择与不存在的 id 非法', () => {
    expect(resolveSelectionChain(nodes, [])).toBeNull()
    expect(resolveSelectionChain(nodes, ['ghost'])).toBeNull()
    expect(resolveSelectionChain(nodes, ['u1', 'ghost'])).toBeNull()
  })

  it('重复 id 非法（防止绕过数量上限）', () => {
    expect(resolveSelectionChain(nodes, ['u1', 'u1'])).toBeNull()
  })

  it('环引用防护：不会死循环，返回 null', () => {
    const cyclic: SelectionNode[] = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]
    expect(resolveSelectionChain(cyclic, ['x'])).toBeNull()
  })

  it('单条消息也是合法选择', () => {
    expect(resolveSelectionChain(nodes, ['a2b'])).toEqual(['a2b'])
  })
})
