import type { ConversationDTO, FolderDTO } from '@shared/types/api'

export interface FolderGroup {
  folder: FolderDTO
  conversations: ConversationDTO[]
}

export interface SidebarSections {
  /** 已置顶分区：置顶文件夹在前、置顶聊天在后 */
  pinnedFolders: FolderGroup[]
  pinnedConversations: ConversationDTO[]
  /** 聊天分区：未置顶文件夹在前、未分组聊天在后 */
  folders: FolderGroup[]
  looseConversations: ConversationDTO[]
}

/**
 * 侧边栏分组规则：
 * - 文件夹是「容器」：成员无论是否置顶都留在文件夹内（保持服务端顺序：置顶在前、按最近排序）。
 * - 置顶是「快捷入口」：置顶聊天始终出现在已置顶分区，文件夹内的聊天置顶后两处都可见。
 * - 未分组且未置顶的聊天留在「聊天」列表。
 * - 置顶文件夹按置顶时间倒序；未置顶文件夹保持服务端创建序（位置稳定，便于形成肌肉记忆）。
 */
export function buildSidebarSections(
  folders: FolderDTO[],
  conversations: ConversationDTO[],
): SidebarSections {
  const byFolder = new Map<string, ConversationDTO[]>()
  for (const conversation of conversations) {
    if (!conversation.folderId) continue
    const items = byFolder.get(conversation.folderId) ?? []
    items.push(conversation)
    byFolder.set(conversation.folderId, items)
  }
  const toGroup = (folder: FolderDTO): FolderGroup => ({
    folder,
    conversations: byFolder.get(folder.id) ?? [],
  })

  return {
    pinnedFolders: folders
      .filter((f) => f.pinnedAt)
      .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
      .map(toGroup),
    pinnedConversations: conversations.filter((c) => c.pinnedAt),
    folders: folders.filter((f) => !f.pinnedAt).map(toGroup),
    looseConversations: conversations.filter((c) => !c.pinnedAt && !c.folderId),
  }
}
