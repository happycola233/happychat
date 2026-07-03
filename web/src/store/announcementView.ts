import { create } from 'zustand'

/**
 * 通知中心「查看详情」的打开状态。与自动强弹窗解耦：
 * viewingId 非空表示用户主动点开某条公告详情。
 */
interface AnnouncementViewStore {
  viewingId: string | null
  open: (id: string) => void
  close: () => void
}

export const useAnnouncementView = create<AnnouncementViewStore>((set) => ({
  viewingId: null,
  open: (id) => set({ viewingId: id }),
  close: () => set({ viewingId: null }),
}))
