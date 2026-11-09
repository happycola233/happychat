import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ImageOptions, ReasoningEffort } from '@shared/types/domain'

/**
 * 编排器偏好：区分「固定默认（持久化）」与「当前会话临时值（不持久化）」。
 * - 仅在选择器中手动选模型时更新固定默认；会话恢复、失效回退和图片编辑只临时生效。
 * - 联网/思考的选择只是「临时用一次」（active）；思考可点固定按钮设为默认（pinnedEffort）。
 * - activeWebSearch / activeXSearch=null 表示沿用当前模型的管理员默认值，避免新会话显式覆盖为 false。
 * - 打开会话时由 ChatView 调 resetActive，从该会话最近一次的模型/联网/X 搜索/思考恢复。
 * - imageOptions 只记录用户主动改过的生图参数（持久化）；未出现的键沿用管理员默认与内置默认，
 *   生效值由 resolveImageOptions 按当前模型解析。
 */
interface ChatPrefs {
  // —— 固定默认（持久化）——
  pinnedModelId: string | null
  pinnedEffort: ReasoningEffort | null
  imageOptions: ImageOptions
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

  /** 更新生图参数覆盖项；传 undefined 表示该项恢复沿用默认。 */
  setImageOptions: (patch: Partial<ImageOptions>) => void
  /** 整体替换（撤回队列消息时恢复当时的选择）。 */
  replaceImageOptions: (options: ImageOptions) => void
}

export const useChatPrefs = create<ChatPrefs>()(
  persist(
    (set, get) => ({
      pinnedModelId: null,
      pinnedEffort: null,
      imageOptions: {},
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

      setImageOptions: (patch) =>
        set((s) => {
          const next: ImageOptions = { ...s.imageOptions, ...patch }
          for (const key of Object.keys(patch) as (keyof ImageOptions)[])
            if (patch[key] === undefined) delete next[key]
          return { imageOptions: next }
        }),
      replaceImageOptions: (options) => set({ imageOptions: { ...options } }),
    }),
    {
      name: 'happychat-prefs',
      version: 1,
      // v0 总是保存 imageSize / imageQuality（默认 'auto'）；迁移为覆盖项，'auto' 视为未选择，
      // 让管理员默认对老用户生效。
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>
        if (version >= 1) return state
        const { imageSize, imageQuality, ...rest } = state
        const imageOptions: ImageOptions = {}
        if (typeof imageSize === 'string' && imageSize !== 'auto') imageOptions.size = imageSize
        if (typeof imageQuality === 'string' && imageQuality !== 'auto')
          imageOptions.quality = imageQuality as ImageOptions['quality']
        return { ...rest, imageOptions }
      },
      // 仅持久化固定默认，临时 active 值不持久化（每会话重置）。
      partialize: (s) => ({
        pinnedModelId: s.pinnedModelId,
        pinnedEffort: s.pinnedEffort,
        imageOptions: s.imageOptions,
      }),
    },
  ),
)
