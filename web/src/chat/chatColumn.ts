/** 聊天列的舒适阅读宽度（48rem），档位为 0 时的固定宽度。 */
const CHAT_COLUMN_READING_WIDTH_PX = 768
/** 消息区左右留白（.hc-chat-scroll-content 的 px-4）。 */
const CHAT_SCROLL_PADDING_X_PX = 16
/** 启用时间轴时聊天列两侧预留的宽度：时间轴（left/right-3 + 56px 宽）不压住铺开后的消息。 */
export const TIMELINE_SIDE_RESERVE_PX = 56

interface ChatColumnWidthOptions {
  /** 聊天滚动区的可视宽度（不含滚动条）。 */
  viewportWidth: number
  /** 聊天区域宽度档位（0–100）。 */
  chatWidth: number
  /** 两侧各自预留的宽度（px）。 */
  sideReserve: number
}

/**
 * 聊天列的实际宽度（px），与 index.css `.hc-chat-column` 的限宽公式一一对应：
 * 阅读宽度 + 档位比例 ×（可用宽度 − 两侧预留 − 阅读宽度），且不超过可用宽度。
 */
export function chatColumnWidthPx({
  viewportWidth,
  chatWidth,
  sideReserve,
}: ChatColumnWidthOptions): number {
  const available = Math.max(0, viewportWidth - CHAT_SCROLL_PADDING_X_PX * 2)
  const extra = Math.max(0, available - sideReserve * 2 - CHAT_COLUMN_READING_WIDTH_PX)
  return Math.min(available, CHAT_COLUMN_READING_WIDTH_PX + (chatWidth / 100) * extra)
}
