import { describe, expect, it } from 'vitest'
import type { ConversationDTO, FolderDTO } from '@shared/types/api'
import { buildSidebarSections } from './sidebarSections'

const folder = (id: string, pinnedAt: number | null = null): FolderDTO => ({
  id,
  name: `文件夹 ${id}`,
  color: null,
  emoji: null,
  pinnedAt,
  createdAt: 1,
  updatedAt: 1,
})

const conversation = (
  id: string,
  { pinnedAt = null, folderId = null }: { pinnedAt?: number | null; folderId?: string | null } = {},
): ConversationDTO => ({
  id,
  title: id,
  modelId: null,
  folderId,
  activeLeafId: null,
  pinnedAt,
  createdAt: 1,
  updatedAt: 1,
})

describe('buildSidebarSections', () => {
  it('splits folders by pin state and sorts pinned folders by pin time desc', () => {
    const sections = buildSidebarSections([folder('a'), folder('b', 100), folder('c', 200)], [])
    expect(sections.pinnedFolders.map((g) => g.folder.id)).toEqual(['c', 'b'])
    // 未置顶文件夹保持服务端创建序
    expect(sections.folders.map((g) => g.folder.id)).toEqual(['a'])
  })

  it('keeps foldered conversations inside their folder and out of the loose list', () => {
    const sections = buildSidebarSections(
      [folder('f1')],
      [conversation('c1', { folderId: 'f1' }), conversation('c2')],
    )
    expect(sections.folders[0]?.conversations.map((c) => c.id)).toEqual(['c1'])
    expect(sections.looseConversations.map((c) => c.id)).toEqual(['c2'])
  })

  it('shows a pinned foldered conversation both in the pinned section and inside its folder', () => {
    const sections = buildSidebarSections(
      [folder('f1')],
      [conversation('c1', { folderId: 'f1', pinnedAt: 5 })],
    )
    expect(sections.pinnedConversations.map((c) => c.id)).toEqual(['c1'])
    expect(sections.folders[0]?.conversations.map((c) => c.id)).toEqual(['c1'])
    expect(sections.looseConversations).toEqual([])
  })

  it('keeps pinned loose conversations out of the loose list (existing behavior)', () => {
    const sections = buildSidebarSections([], [conversation('c1', { pinnedAt: 5 })])
    expect(sections.pinnedConversations.map((c) => c.id)).toEqual(['c1'])
    expect(sections.looseConversations).toEqual([])
  })

  it('represents empty folders with an empty member list', () => {
    const sections = buildSidebarSections([folder('f1')], [])
    expect(sections.folders[0]?.conversations).toEqual([])
  })
})
