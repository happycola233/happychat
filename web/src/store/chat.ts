import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReasoningEffort } from '@shared/types/domain'

/**
 * 编排器偏好：区分「固定默认（持久化）」与「当前会话临时值（不持久化）」。
 * - 仅在选择器中手动选模型时更新固定默认；会话恢复、失效回退和图片编辑只临时生效。
 * - 联网/思考的选择只是「临时用一次」（active）；思考可点固定按钮设为默认（pinnedEffort）。
 * - activeWebSearch / activeXSearch=null 表示沿用当前模型的管理员默认值，避免新会话显式覆盖为 false。
 * - 打开会话时由 ChatView 调 resetActive，从该会话最近一次的模型/联网/X 搜索/思考恢复。
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
  activeXSearch: boolean | null
  activeEffort: ReasoningEffort | null

  /** 选择器中的手动选模：临时生效并更新固定默认（新会话沿用）。 */
  selectModel: (id: string) => void
  /** 自动切换模型：只临时生效，不改变新会话默认。 */
  setActiveModel: (id: string | null) => void
  /** 目录加载或更新后校正临时模型：优先固定默认，再回退首个可用模型。 */
  reconcileActiveModel: (models: readonly { id: string }[]) => void
  setActiveWebSearch: (v: boolean) => void
  setActiveXSearch: (v: boolean) => void
  /** 临时设置推理强度（不固定）。 */
  setActiveEffort: (e: ReasoningEffort | null) => void
  /** 把某推理强度设为固定默认（再次点击同值取消固定）。 */
  pinEffort: (e: ReasoningEffort) => void
  /** 打开会话时恢复控件：缺省项回退固定默认。 */
  resetActive: (init: {
    modelId?: string | null
    webSearch?: boolean
    xSearch?: boolean
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
      activeXSearch: null,
      activeEffort: null,

      selectModel: (id) => set({ activeModelId: id, pinnedModelId: id }),
      setActiveModel: (id) => set({ activeModelId: id }),
      reconcileActiveModel: (models) => {
        const { activeModelId, pinnedModelId } = get()
        if (models.some((model) => model.id === activeModelId)) return
        const fallbackModelId =
          models.find((model) => model.id === pinnedModelId)?.id ?? models[0]?.id ?? null
        if (activeModelId !== fallbackModelId) set({ activeModelId: fallbackModelId })
      },
      setActiveWebSearch: (v) => set({ activeWebSearch: v }),
      setActiveXSearch: (v) => set({ activeXSearch: v }),
      setActiveEffort: (e) => set({ activeEffort: e }),
      pinEffort: (e) => set({ pinnedEffort: get().pinnedEffort === e ? null : e }),
      resetActive: ({ modelId, webSearch, xSearch, effort }) =>
        set((s) => ({
          activeModelId: modelId ?? s.pinnedModelId,
          activeWebSearch: webSearch ?? null,
          activeXSearch: xSearch ?? null,
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
