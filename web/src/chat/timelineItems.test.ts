import { describe, expect, it } from 'vitest'
import type { MessageDTO } from '@shared/types/api'
import {
  resolveActiveTimelineId,
  shouldShowTimeline,
  timelineItemsFromMessages,
  TIMELINE_JUMP_OFFSET_PX,
} from './timelineItems'

function userMessage(id: string, text: string): MessageDTO {
  return {
    id,
    role: 'user',
    content: text ? [{ type: 'input_text', text }] : [],
  } as unknown as MessageDTO
}

function assistantMessage(id: string, text = '回复'): MessageDTO {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
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
      { id: 'u1', prompt: '第一行 第二行 结尾', reply: '回复', bookmarked: false },
      { id: 'u2', prompt: '你好', reply: '等待回复', bookmarked: false },
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
      { id: 'u1', prompt: '[图片]', reply: '等待回复', bookmarked: false },
      { id: 'u2', prompt: '[附件]', reply: '等待回复', bookmarked: false },
    ])
  })

  it('逐轮配对当前分支回复，保留 Markdown 与收藏，不串入下一轮', () => {
    const markdown = '**重点。**后续\n\n- 第一项\n- 第二项'
    const items = timelineItemsFromMessages([
      { ...userMessage('u1', '提问一'), bookmarked: true },
      assistantMessage('a1', markdown),
      userMessage('u2', '提问二'),
      assistantMessage('a2', '另一个回复'),
      userMessage('u3', '还没回复'),
    ])
    expect(items.map(({ reply }) => reply)).toEqual([markdown, '另一个回复', '等待回复'])
    expect(items[0]?.bookmarked).toBe(true)
  })

  it('使用当前流式正文，不把 reasoning 或 commentary 当作回复', () => {
    const user = userMessage('u1', '提问')
    const assistant = assistantMessage('a1', '旧正文')
    assistant.content.unshift({ type: 'output_text', text: '过程说明', phase: 'commentary' })
    expect(timelineItemsFromMessages([user, assistant])[0]?.reply).toBe('旧正文')
    expect(
      timelineItemsFromMessages([user, assistant], {
        assistantMessageId: 'a1',
        text: '**正在更新**',
        status: 'streaming',
      })[0]?.reply,
    ).toBe('**正在更新**')
    expect(
      timelineItemsFromMessages([user, assistant], {
        assistantMessageId: 'a1',
        text: '',
        status: 'streaming',
      })[0]?.reply,
    ).toBe('正在回复…')
  })

  it('生成图片有明确摘要，长文本限制预览解析量', () => {
    const image = assistantMessage('a1', '')
    image.content = [{ type: 'image_result', attachment_id: 'image-1' }]
    expect(timelineItemsFromMessages([userMessage('u1', '画一朵花'), image])[0]?.reply).toBe(
      '已生成图片',
    )
    expect(
      timelineItemsFromMessages([
        userMessage('u2', '长文'),
        assistantMessage('a2', '文'.repeat(50000)),
      ])[0]?.reply,
    ).toHaveLength(2000)
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

  it('大屏跳转到短消息时，受限激活线不会误选下一轮', () => {
    const shortAnchors = [
      { id: 'u1', top: 68 },
      { id: 'u2', top: 300 },
      { id: 'u3', top: 600 },
    ]
    const clientHeight = 960
    const activationRatio = Math.min(0.35, (TIMELINE_JUMP_OFFSET_PX + 20) / clientHeight)
    expect(resolveActiveTimelineId(shortAnchors, 0, clientHeight, 2000, activationRatio)).toBe('u1')
    expect(
      resolveActiveTimelineId(
        shortAnchors,
        300 - TIMELINE_JUMP_OFFSET_PX,
        clientHeight,
        2000,
        activationRatio,
      ),
    ).toBe('u2')
  })
})
