import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 模型选择器的本地视图状态。
 *
 * 只放「纯客户端、丢了也无所谓」的展开/折叠状态——视图模式（平铺/二级目录）是账户级偏好，
 * 存在服务端的 `user_settings.preferences`（见 store/settings.ts），不在这里。
 * 折叠状态的持久化策略与侧边栏文件夹展开态（store/sidebar.ts）保持一致。
 */
interface ModelPickerStore {
  /** 已折叠的分组 id（未出现的分组默认展开）。 */
  collapsedGroups: Record<string, boolean>
  toggleGroupCollapsed: (groupId: string) => void
}

export const useModelPickerStore = create<ModelPickerStore>()(
  persist(
    (set) => ({
      collapsedGroups: {},
      toggleGroupCollapsed: (groupId) =>
        set((state) => ({
          collapsedGroups: {
            ...state.collapsedGroups,
            [groupId]: !state.collapsedGroups[groupId],
          },
        })),
    }),
    {
      name: 'happychat-model-picker',
      partialize: (s) => ({ collapsedGroups: s.collapsedGroups }),
    },
  ),
)
