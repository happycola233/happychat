import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarStore {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggleCollapsed: () => void
  pinnedSectionCollapsed: boolean
  recentSectionCollapsed: boolean
  setPinnedSectionCollapsed: (collapsed: boolean) => void
  setRecentSectionCollapsed: (collapsed: boolean) => void
  togglePinnedSectionCollapsed: () => void
  toggleRecentSectionCollapsed: () => void
  /** 展开的文件夹 id 集合（持久化，跨会话记住展开状态） */
  expandedFolders: Record<string, boolean>
  toggleFolderExpanded: (folderId: string) => void
  /** 仅展开（用于打开文件夹内会话时自动定位） */
  expandFolder: (folderId: string) => void
  /** 移动端抽屉是否打开（不持久化） */
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      collapsed: false,
      setCollapsed: (collapsed) => set({ collapsed }),
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
      pinnedSectionCollapsed: false,
      recentSectionCollapsed: false,
      setPinnedSectionCollapsed: (collapsed) => set({ pinnedSectionCollapsed: collapsed }),
      setRecentSectionCollapsed: (collapsed) => set({ recentSectionCollapsed: collapsed }),
      togglePinnedSectionCollapsed: () =>
        set((state) => ({ pinnedSectionCollapsed: !state.pinnedSectionCollapsed })),
      toggleRecentSectionCollapsed: () =>
        set((state) => ({ recentSectionCollapsed: !state.recentSectionCollapsed })),
      expandedFolders: {},
      toggleFolderExpanded: (folderId) =>
        set((state) => ({
          expandedFolders: {
            ...state.expandedFolders,
            [folderId]: !state.expandedFolders[folderId],
          },
        })),
      expandFolder: (folderId) =>
        set((state) =>
          state.expandedFolders[folderId]
            ? state
            : { expandedFolders: { ...state.expandedFolders, [folderId]: true } },
        ),
      mobileOpen: false,
      setMobileOpen: (open) => set({ mobileOpen: open }),
    }),
    {
      name: 'happychat-sidebar',
      partialize: (s) => ({
        collapsed: s.collapsed,
        pinnedSectionCollapsed: s.pinnedSectionCollapsed,
        recentSectionCollapsed: s.recentSectionCollapsed,
        expandedFolders: s.expandedFolders,
      }),
    },
  ),
)

/** 移动端断点（<768px）检测，驱动抽屉模式。 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = () => setMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
