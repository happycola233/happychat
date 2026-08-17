import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 管理后台桌面侧栏折叠态。与聊天侧栏 store 分开：两边的宽窄偏好互不影响。
 * 只持久化 collapsed；移动端仍走顶部横滑标签，不读这个开关。
 */
interface AdminSidebarStore {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggleCollapsed: () => void
}

export const ADMIN_SIDEBAR_STORAGE_KEY = 'happychat-admin-sidebar'

/** 首屏同步读一次，避免 persist 异步回填时侧栏先展开再收起。 */
export function readPersistedAdminSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { state?: { collapsed?: unknown } }
    return parsed.state?.collapsed === true
  } catch {
    return false
  }
}

export const useAdminSidebarStore = create<AdminSidebarStore>()(
  persist(
    (set) => ({
      collapsed:
        typeof localStorage === 'undefined' ? false : readPersistedAdminSidebarCollapsed(),
      setCollapsed: (collapsed) => set({ collapsed }),
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    {
      name: ADMIN_SIDEBAR_STORAGE_KEY,
      partialize: (s) => ({ collapsed: s.collapsed }),
    },
  ),
)
