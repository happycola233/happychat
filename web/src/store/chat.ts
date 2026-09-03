import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReasoningEffort } from '@shared/types/domain'

/**
 * 编排器偏好：区分「固定默认（持久化）」与「当前会话临时值（不持久化）」。
 * - 选模型即时生效，并更新固定默认（作为新会话默认）。
 * - 联网/思考的选择只是「临时用一次」（active）；思考可点固定按钮设为默认（pinnedEffort）。
 * - activeWebSearch / activeXSearch=null 表示沿用当前模型的管理员默认值，避免新会话显式覆盖为 false。
 * - activeEffort=null 表示未指定档位，请求由模型默认配置决定。
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

  /** 选择模型：临时生效并更新固定默认（新会话沿用）。 */
  setActiveModel: (id: string) => void
  setActiveWebSearch: (v: boolean) => void
  setActiveXSearch: (v: boolean) => void
  /** 临时选择推理强度；再次选择同一档时回到自动。 */
  toggleActiveEffort: (e: ReasoningEffort) => void
  /** 把某推理强度设为固定默认（再次点击同值取消固定）。 */
  pinEffort: (e: ReasoningEffort) => void
  /** 打开会话时恢复控件：未传 effort 时回退固定默认，显式 null 保持自动。 */
  resetActive: (init: {
    modelId?: string | null
    webSearch?: boolean
    xSearch?: boolean
    effort?: ReasoningEffort | null
  }) => void

  setImageSize: (s: string) => void
  setImageQuality: (q: string) => void
}

export function toggleReasoningEffortSelection(
  activeEffort: ReasoningEffort | null,
  selectedEffort: ReasoningEffort,
): ReasoningEffort | null {
  return activeEffort === selectedEffort ? null : selectedEffort
}

export function resolveActiveReasoningEffort(
  restoredEffort: ReasoningEffort | null | undefined,
  pinnedEffort: ReasoningEffort | null,
): ReasoningEffort | null {
  return restoredEffort === undefined ? pinnedEffort : restoredEffort
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

      setActiveModel: (id) => set({ activeModelId: id, pinnedModelId: id }),
      setActiveWebSearch: (v) => set({ activeWebSearch: v }),
      setActiveXSearch: (v) => set({ activeXSearch: v }),
      toggleActiveEffort: (e) =>
        set((s) => ({ activeEffort: toggleReasoningEffortSelection(s.activeEffort, e) })),
      pinEffort: (e) => set({ pinnedEffort: get().pinnedEffort === e ? null : e }),
      resetActive: ({ modelId, webSearch, xSearch, effort }) =>
        set((s) => ({
          activeModelId: modelId ?? s.pinnedModelId,
          activeWebSearch: webSearch ?? null,
          activeXSearch: xSearch ?? null,
          activeEffort: resolveActiveReasoningEffort(effort, s.pinnedEffort),
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
