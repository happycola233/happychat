import type { MessageDTO } from '@shared/types/api'
import { textFromContent } from './contentText'

/** 时间轴导航中的一条用户消息。 */
export interface TimelineItem {
  id: string
  /** 单行预览文本（已压缩空白），过长由 CSS 截断。 */
  label: string
}

/** 用户消息数超过该值才显示时间轴导航（需求：大于 3 条）。 */
export const TIMELINE_MIN_USER_MESSAGES = 3

/**
 * 从当前可见路径消息中提取时间轴条目。
 * 只取用户消息（buildPath 已保证每条用户消息在路径上仅出现一次，
 * 编辑/重试产生的兄弟分支不会重复计入）。
 */
export function timelineItemsFromMessages(messages: MessageDTO[]): TimelineItem[] {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => {
      const text = textFromContent(m.content).replace(/\s+/g, ' ').trim()
      if (text) return { id: m.id, label: text }
      // 纯附件消息没有正文，用占位标签让列表行保持可读。
      const hasImage = m.content.some((p) => p.type === 'input_image')
      return { id: m.id, label: hasImage ? '[图片]' : '[附件]' }
    })
}

export function shouldShowTimeline(itemCount: number): boolean {
  return itemCount > TIMELINE_MIN_USER_MESSAGES
}

/** 锚点在滚动内容坐标系中的位置（top 相对滚动容器内容顶部）。 */
export interface TimelineAnchor {
  id: string
  top: number
}

/**
 * 根据滚动位置求当前所处的用户消息：
 * 取“激活线”（视口顶部向下 activationRatio 处）之上最近的一条；
 * 全部在激活线之下时归首条，滚动到底时归最后一条。
 */
export function resolveActiveTimelineId(
  anchors: TimelineAnchor[],
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  activationRatio = 0.35,
): string | null {
  if (!anchors.length) return null
  const last = anchors[anchors.length - 1]!
  if (scrollHeight - scrollTop - clientHeight <= 2) return last.id
  const activationLine = scrollTop + clientHeight * activationRatio
  let active = anchors[0]!
  for (const anchor of anchors) {
    if (anchor.top <= activationLine) active = anchor
    else break
  }
  return active.id
}
