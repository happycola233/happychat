import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReasoningEffort } from '@shared/types/domain'

/**
 * 编排器偏好：区分「固定默认（持久化）」与「当前会话临时值（不持久化）」。
 * - 选模型即时生效，并更新固定默认（作为新会话默认）。
 * - 联网/思考的选择只是「临时用一次」（active）；思考可点固定按钮设为默认（pinnedEffort）。
 * - activeWebSearch=null 表示沿用当前模型的管理员默认值，避免新会话显式覆盖为 false。
 * - 打开会话时由 ChatView 调 resetActive，从该会话最近一次的模型/联网/思考恢复。
 */
interface ChatPrefs {
  // —— 固定默认（持久化）——
  pinnedModelId: string | null
  pinnedEffort: ReasoningEffort | null
  imageSize: string
  imageQuality: string
  // —— 当前会话临时值（不持久化）——
  activeModelId: string | null
  activeWebSearch: boolean | null
  activeEffort: ReasoningEffort | null

  /** 选择模型：临时生效并更新固定默认（新会话沿用）。 */
  setActiveModel: (id: string) => void
  setActiveWebSearch: (v: boolean) => void
  /** 临时设置思考深度（不固定）。 */
  setActiveEffort: (e: ReasoningEffort | null) => void
  /** 把某思考深度设为固定默认（再次点击同值取消固定）。 */
  pinEffort: (e: ReasoningEffort) => void
  /** 打开会话时恢复控件：缺省项回退固定默认。 */
  resetActive: (init: {
    modelId?: string | null
    webSearch?: boolean
    effort?: ReasoningEffort | null
  }) => void

  setImageSize: (s: string) => void
  setImageQuality: (q: string) => void
}

export const useChatPrefs = create<ChatPrefs>()(
  persist(
    (set, get) => ({
      pinnedModelId: null,
      pinnedEffort: null,
      imageSize: 'auto',
      imageQuality: 'auto',
      activeModelId: null,
      activeWebSearch: null,
      activeEffort: null,

      setActiveModel: (id) => set({ activeModelId: id, pinnedModelId: id }),
      setActiveWebSearch: (v) => set({ activeWebSearch: v }),
      setActiveEffort: (e) => set({ activeEffort: e }),
      pinEffort: (e) => set({ pinnedEffort: get().pinnedEffort === e ? null : e }),
      resetActive: ({ modelId, webSearch, effort }) =>
        set((s) => ({
          activeModelId: modelId ?? s.pinnedModelId,
          activeWebSearch: webSearch ?? null,
          activeEffort: effort ?? s.pinnedEffort,
        })),

      setImageSize: (s) => set({ imageSize: s }),
      setImageQuality: (q) => set({ imageQuality: q }),
    }),
    {
      name: 'happychat-prefs',
      // 仅持久化固定默认，临时 active 值不持久化（每会话重置）。
      partialize: (s) => ({
        pinnedModelId: s.pinnedModelId,
        pinnedEffort: s.pinnedEffort,
        imageSize: s.imageSize,
        imageQuality: s.imageQuality,
      }),
    },
  ),
)
