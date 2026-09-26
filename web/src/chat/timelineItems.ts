import type { MessageDTO } from '@shared/types/api'
import { textFromContent } from './contentText'
import type { ActiveStream } from '../store/stream'

/** 当前分支的一轮对话，以用户消息作为跳转与收藏锚点。 */
export interface TimelineItem {
  id: string
  /** 单行预览文本（已压缩空白），过长由 CSS 截断。 */
  prompt: string
  /** 保留 Markdown 与换行，仅在悬停时渲染这一轮回复。 */
  reply: string
  bookmarked: boolean
}

/** 用户消息数超过该值才显示时间轴导航（需求：大于 3 条）。 */
export const TIMELINE_MIN_USER_MESSAGES = 3
/** 跳转后给悬浮顶栏让位；当前位置激活线也以此为基准。 */
export const TIMELINE_JUMP_OFFSET_PX = 76

/**
 * 从当前可见路径消息中提取时间轴条目。
 * 只取用户消息（buildPath 已保证每条用户消息在路径上仅出现一次，
 * 编辑/重试产生的兄弟分支不会重复计入）。
 */
export function timelineItemsFromMessages(
  messages: MessageDTO[],
  live?: Pick<ActiveStream, 'assistantMessageId' | 'text' | 'status'>,
): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const prompt = textFromContent(message.content).replace(/\s+/g, ' ').trim()
      const hasImage = message.content.some((part) => part.type === 'input_image')
      items.push({
        id: message.id,
        prompt: prompt || (hasImage ? '[图片]' : '[附件]'),
        reply: '等待回复',
        bookmarked: message.bookmarked ?? false,
      })
    } else if (message.role === 'assistant' && items.length > 0) {
      const item = items[items.length - 1]!
      const activeStream = live?.assistantMessageId === message.id ? live : undefined
      const text = activeStream
        ? activeStream.text
        : textFromContent(
            message.content.filter(
              (part) => part.type !== 'output_text' || part.phase !== 'commentary',
            ),
          )
      const hasImage = message.content.some((part) => part.type === 'image_result')
      const generating = activeStream
        ? activeStream.status === 'streaming'
        : message.status === 'streaming'
      // 只解析短摘要，避免掠过刻度时对整篇长回复执行 Markdown 排版。
      item.reply =
        text.trim().slice(0, 2000) ||
        (generating ? '正在回复…' : hasImage ? '已生成图片' : '暂无文字回复')
    }
  }
  return items
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
