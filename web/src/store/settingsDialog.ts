import { create } from 'zustand'

export type SettingsTab = 'appearance' | 'chat' | 'messages' | 'account' | 'shares' | 'about'

interface SettingsDialogStore {
  open: boolean
  tab: SettingsTab
  openDialog: (tab?: SettingsTab) => void
  closeDialog: () => void
  setTab: (tab: SettingsTab) => void
}

/** 设置弹窗的开合状态，任意组件可调用 openDialog 打开。 */
export const useSettingsDialog = create<SettingsDialogStore>((set) => ({
  open: false,
  tab: 'appearance',
  openDialog: (tab = 'appearance') => set({ open: true, tab }),
  closeDialog: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
}))
