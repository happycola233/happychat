// 字号由 --hc-msg-font 驱动（见 index.css 的 .hc-font-* 与 store/settings.ts）。
export const MESSAGE_BODY_TEXT_CLASS =
  'text-[length:var(--hc-msg-font)] leading-[1.6] text-neutral-800 dark:text-neutral-100'

// 用户消息内联编辑：短内容给足起步高度，长内容与折叠预览共用同一个可视上限。
export const USER_MESSAGE_EDIT_MIN_HEIGHT = 152
export const USER_MESSAGE_EDIT_MAX_HEIGHT = 352
export const USER_MESSAGE_EDIT_VIEWPORT_RATIO = 0.45

export function getUserMessageEditVisibleHeight(viewportHeight: number) {
  return Math.max(
    USER_MESSAGE_EDIT_MIN_HEIGHT,
    Math.min(USER_MESSAGE_EDIT_MAX_HEIGHT, Math.round(viewportHeight * USER_MESSAGE_EDIT_VIEWPORT_RATIO)),
  )
}
