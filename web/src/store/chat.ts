import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReasoningEffort } from '@shared/types/domain'

// 用户可调并记忆的偏好（持久化到 localStorage，下次打开自动沿用）。
interface ChatPrefs {
  selectedModelId: string | null
  webSearch: boolean
  reasoningEffort: ReasoningEffort | null
  imageSize: string
  imageQuality: string
  setSelectedModel: (id: string) => void
  setWebSearch: (v: boolean) => void
  setReasoningEffort: (e: ReasoningEffort | null) => void
  setImageSize: (s: string) => void
  setImageQuality: (q: string) => void
}

export const useChatPrefs = create<ChatPrefs>()(
  persist(
    (set) => ({
      selectedModelId: null,
      webSearch: false,
      reasoningEffort: null,
      imageSize: 'auto',
      imageQuality: 'auto',
      setSelectedModel: (id) => set({ selectedModelId: id }),
      setWebSearch: (v) => set({ webSearch: v }),
      setReasoningEffort: (e) => set({ reasoningEffort: e }),
      setImageSize: (s) => set({ imageSize: s }),
      setImageQuality: (q) => set({ imageQuality: q }),
    }),
    { name: 'happychat-prefs' },
  ),
)
