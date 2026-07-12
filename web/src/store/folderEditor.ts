import { create } from 'zustand'
import type { FolderDTO } from '@shared/types/api'

interface FolderEditorState {
  /** 编辑目标；null=新建模式 */
  folder: FolderDTO | null
  open: boolean
  /** 新建成功后的回调（如「新建并把所选聊天移入」）。 */
  onCreated: ((folder: FolderDTO) => void) | null
  openCreate: (onCreated?: (folder: FolderDTO) => void) => void
  openEdit: (folder: FolderDTO) => void
  close: () => void
}

/**
 * 文件夹设置弹窗的全局状态：入口很多（侧栏标题按钮、行内菜单、批量工具栏、
 * 会话顶栏菜单），统一由 ChatLayout 挂载一份 FolderEditorDialog 渲染。
 */
export const useFolderEditor = create<FolderEditorState>((set) => ({
  folder: null,
  open: false,
  onCreated: null,
  openCreate: (onCreated) => set({ open: true, folder: null, onCreated: onCreated ?? null }),
  openEdit: (folder) => set({ open: true, folder, onCreated: null }),
  close: () => set({ open: false, folder: null, onCreated: null }),
}))
