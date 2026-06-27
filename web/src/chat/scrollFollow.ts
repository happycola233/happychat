const SCROLL_DIRECTION_TOLERANCE_PX = 1
const AUTO_FOLLOW_RESUME_DISTANCE_PX = 2

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
}

interface ResolveAutoFollowArgs {
  isAutoFollowing: boolean
  isProgrammaticScroll: boolean
  previous: ScrollMetrics
  current: ScrollMetrics
  clientHeight: number
}

/**
 * 根据一次真实滚动后的几何变化更新自动跟随状态。
 *
 * 关键点是“向上滚动”本身就代表用户要阅读历史内容，不能再用距底部
 * 是否超过一大段阈值来推断意图；否则流式增量会在用户慢慢上滚时反复拉回底部。
 */
export function resolveAutoFollowAfterScroll({
  isAutoFollowing,
  isProgrammaticScroll,
  previous,
  current,
  clientHeight,
}: ResolveAutoFollowArgs): boolean {
  const scrollTopDelta = current.scrollTop - previous.scrollTop
  const contentShrank = current.scrollHeight < previous.scrollHeight - SCROLL_DIRECTION_TOLERANCE_PX

  // 内容折叠或切换会话也可能让 scrollTop 变小；这不属于用户向上翻阅。
  const userScrolledUp =
    scrollTopDelta < -SCROLL_DIRECTION_TOLERANCE_PX && !isProgrammaticScroll && !contentShrank
  if (userScrolledUp) return false

  const userScrolledDown = scrollTopDelta > SCROLL_DIRECTION_TOLERANCE_PX
  const distanceFromBottom = Math.max(0, current.scrollHeight - current.scrollTop - clientHeight)

  // 暂停后只在用户确实向下回到底部时恢复，内容增长本身不能偷偷恢复跟随。
  if (userScrolledDown && distanceFromBottom <= AUTO_FOLLOW_RESUME_DISTANCE_PX) return true

  return isAutoFollowing
}
