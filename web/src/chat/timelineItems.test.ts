import { describe, expect, it } from 'vitest'
import type { MessageDTO } from '@shared/types/api'
import {
  resolveActiveTimelineId,
  shouldShowTimeline,
  timelineItemsFromMessages,
} from './timelineItems'

function userMessage(id: string, text: string): MessageDTO {
  return {
    id,
    role: 'user',
    content: text ? [{ type: 'input_text', text }] : [],
  } as unknown as MessageDTO
}

function assistantMessage(id: string): MessageDTO {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'output_text', text: '回复', annotations: [] }],
  } as unknown as MessageDTO
}

describe('timelineItemsFromMessages', () => {
  it('只收集用户消息并压缩空白为单行预览', () => {
    const items = timelineItemsFromMessages([
      userMessage('u1', '  第一行\n第二行\t结尾  '),
      assistantMessage('a1'),
      userMessage('u2', '你好'),
    ])
    expect(items).toEqual([
      { id: 'u1', label: '第一行 第二行 结尾' },
      { id: 'u2', label: '你好' },
    ])
  })

  it('纯附件消息使用占位标签', () => {
    const withImage = {
      id: 'u1',
      role: 'user',
      content: [{ type: 'input_image', attachmentId: 'att1' }],
    } as unknown as MessageDTO
    const withFile = {
      id: 'u2',
      role: 'user',
      content: [{ type: 'input_file', attachmentId: 'att2', filename: 'a.txt' }],
    } as unknown as MessageDTO
    expect(timelineItemsFromMessages([withImage, withFile])).toEqual([
      { id: 'u1', label: '[图片]' },
      { id: 'u2', label: '[附件]' },
    ])
  })
})

describe('shouldShowTimeline', () => {
  it('用户消息数大于 3 条才显示', () => {
    expect(shouldShowTimeline(3)).toBe(false)
    expect(shouldShowTimeline(4)).toBe(true)
  })
})

describe('resolveActiveTimelineId', () => {
  const anchors = [
    { id: 'u1', top: 0 },
    { id: 'u2', top: 500 },
    { id: 'u3', top: 1200 },
  ]

  it('空锚点返回 null', () => {
    expect(resolveActiveTimelineId([], 0, 600, 2000)).toBeNull()
  })

  it('取激活线之上最近的锚点', () => {
    // 激活线 = 400 + 600*0.35 = 610 → u2（500）在其上，u3（1200）在其下
    expect(resolveActiveTimelineId(anchors, 400, 600, 3000)).toBe('u2')
  })

  it('全部在激活线之下时归首条', () => {
    const belowAnchors = anchors.map((a) => ({ ...a, top: a.top + 300 }))
    // 激活线 = 0 + 400*0.35 = 140，首个锚点 top=300 也在其下 → 仍归首条
    expect(resolveActiveTimelineId(belowAnchors, 0, 400, 3000, 0.35)).toBe('u1')
  })

  it('滚动到底部时归最后一条', () => {
    expect(resolveActiveTimelineId(anchors, 2400, 600, 3000)).toBe('u3')
  })
})
