import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MessageQueue } from './MessageQueue'
import type { ConversationMessageQueue } from '../store/messageQueue'

const queue: ConversationMessageQueue = {
  items: [
    {
      id: 'one',
      input: { modelId: 'model', text: '下一条提问' },
      attachments: [],
      imageSources: [],
      modelName: '模型',
      reasoningEnabled: false,
      runPrefs: null,
    },
  ],
  parentId: 'answer',
  waitingRunId: 'run',
  sendingId: null,
  conversationId: 'conversation',
  revision: 1,
  reorderUntil: null,
  paused: false,
  error: null,
}
const actions = {
  onEdit: vi.fn(),
  onRemove: vi.fn(),
  onResume: vi.fn(),
  onReorderStart: vi.fn(),
  onReorderEnd: vi.fn(),
}

describe('队列界面', () => {
  it('提供编辑与删除入口、读屏状态，使用原图标，不提供引导操作', () => {
    const html = renderToStaticMarkup(<MessageQueue queue={queue} {...actions} />)
    expect(html).toContain('下一条提问')
    expect(html).toContain('编辑第 1 条排队消息')
    expect(html).toContain('删除第 1 条排队消息')
    expect(html).toContain('拖动第 1 条排队消息')
    expect(html).toContain('第 1 条排队消息的更多操作')
    expect(html).toContain('可排序消息')
    expect(html).toContain('role="status"')
    expect(html).toContain('M2.668 11V3.333')
    expect(html).not.toContain('引导')
  })
  it('图片消息显示缩略图和数量；编辑入口不再展开行内输入框', () => {
    const message = queue.items[0]!
    const html = renderToStaticMarkup(
      <MessageQueue
        queue={{
          ...queue,
          items: [
            {
              ...message,
              input: { ...message.input, text: '' },
              attachments: [
                {
                  id: 'example-image',
                  kind: 'image',
                  filename: 'example.png',
                  mime: 'image/png',
                  byteSize: 128,
                },
              ],
            },
          ],
        }}
        {...actions}
      />,
    )
    expect(html).toContain('1 张图像')
    expect(html).toContain('src="/api/attachments/example-image"')
    expect(html).toContain('编辑消息')
    expect(html).not.toContain('<textarea')
  })
  it('失败时可继续；空队列不占空间', () => {
    const paused = renderToStaticMarkup(
      <MessageQueue queue={{ ...queue, paused: true, error: '额度不足' }} {...actions} />,
    )
    expect(paused).toContain('额度不足')
    expect(paused).toContain('继续发送')
    expect(
      renderToStaticMarkup(<MessageQueue queue={{ ...queue, items: [] }} {...actions} />),
    ).toBe('')
  })
})
