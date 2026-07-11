/** 消息列最大宽度（Tailwind max-w-3xl）。 */
const MESSAGE_COLUMN_MAX_WIDTH_PX = 768
/** 顶栏单侧按钮簇（含边距）所需的横向空间。 */
const TOP_BAR_SIDE_CLEARANCE_PX = 140
const TOP_FADE_VIEWPORT_THRESHOLD_PX = MESSAGE_COLUMN_MAX_WIDTH_PX + TOP_BAR_SIDE_CLEARANCE_PX * 2

interface TopFadeVisibilityOptions {
  viewportWidth: number
  /** 已进入持久化会话；详情加载期间也保持原有顶栏表现。 */
  hasConversation: boolean
  /** 包含持久化消息与发送中的乐观消息。 */
  hasVisibleMessages: boolean
  /** 首条消息正在从 hero 居中态落底。 */
  isDocking: boolean
}

/**
 * 顶栏渐变只负责兜住进入按钮区域的消息内容。
 *
 * 首条消息成功后，乐观消息会早于路由 id 被清空；落底标记需要在这段交接期
 * 继续保留渐变，避免它闪灭再出现。真正空闲的新聊天则不渲染渐变，以免遮住
 * 从 Composer 侧向展开的模型面板。
 */
export function shouldShowTopFade({
  viewportWidth,
  hasConversation,
  hasVisibleMessages,
  isDocking,
}: TopFadeVisibilityOptions): boolean {
  const canHaveContentBehindTopBar = hasConversation || hasVisibleMessages || isDocking
  return canHaveContentBehindTopBar && viewportWidth < TOP_FADE_VIEWPORT_THRESHOLD_PX
}
