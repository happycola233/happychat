import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  description?: string
  /** 确认按钮文案，默认「确认」。 */
  confirmLabel?: string
  /** 取消按钮文案，默认「取消」。 */
  cancelLabel?: string
  /** danger=红色确认按钮（删除类操作）。 */
  tone?: 'danger' | 'default'
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

interface ConfirmStore {
  /** 当前待确认请求；一次只显示一个。 */
  current: ConfirmRequest | null
  ask: (options: ConfirmOptions) => Promise<boolean>
  settle: (confirmed: boolean) => void
}

/**
 * 应用级确认对话框（替代 window.confirm）：
 * store 持有请求，`ConfirmDialogHost` 在 App 顶层渲染。
 * 事件处理器里直接 `await askConfirm({...})` 即可。
 */
export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  current: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      // 极端情况下已有未决请求：视为取消，避免悬挂的 Promise。
      get().current?.resolve(false)
      set({ current: { ...options, resolve } })
    }),
  settle: (confirmed) => {
    get().current?.resolve(confirmed)
    set({ current: null })
  },
}))

/** 便捷函数：组件外/事件处理器中直接调用。 */
export const askConfirm = (options: ConfirmOptions): Promise<boolean> =>
  useConfirmStore.getState().ask(options)
