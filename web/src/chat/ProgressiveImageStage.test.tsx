import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialLive } from '../sse/eventReducer'
import { ProgressiveImageStage } from './ProgressiveImageStage'
import { ImageWaitingGame } from './ImageWaitingGame'

describe('ProgressiveImageStage', () => {
  it('keeps the stage status and canvas while a partial image is decoding', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage
        live={{
          ...initialLive(),
          imageGenerations: [
            {
              id: 'ig_0',
              index: 0,
              outputIndex: null,
              status: 'generating',
              previewAttachmentId: 'att_partial_3',
              previewIndex: 2,
              previewUpdatedAt: 1000,
              startedAt: 0,
              completedAt: null,
            },
          ],
        }}
      />,
    )

    expect(html).toContain('仍在生成（阶段 3）')
    expect(html).not.toContain('预览 3')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('/api/attachments/att_partial_3')
    expect(html).not.toContain('实时预览')
    expect(html).toContain('<canvas')
    expect(html).toContain('data-active=""')
    expect(html).toContain('aria-label="预览生成中的图片"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('贪吃蛇游戏区域')
  })

  it('shows an honest waiting state before the first image arrives', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage live={{ ...initialLive(), imageStatus: 'generating' }} />,
    )
    expect(html).toContain('hc-image-waiting-field')
    expect(html).toContain('<canvas')
    expect(html).toContain('data-active=""')
    expect(html).toContain('正在生成图片')
    expect(html).not.toContain('role="progressbar"')
    expect(html).toContain('hc-image-stage-body')
  })

  it('preserves a stopped partial image without offering a game', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage
        live={{
          ...initialLive(),
          status: 'canceled',
          imageStatus: 'generating',
          imagePreviewAttachmentId: 'partial',
        }}
      />,
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('aria-label="预览生成中的图片"')
    expect(html).toContain('已停止')
    expect(html).not.toContain('玩贪吃蛇')
    expect(html).toContain('hc-image-waiting-field')
    expect(html).toContain('<canvas')
    expect(html).not.toContain('data-active=')
  })

  it('shows completion metadata while the final image is decoding', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage
        live={{
          ...initialLive(),
          status: 'completed',
          imageGenerations: [
            {
              id: 'image',
              index: 0,
              outputIndex: null,
              status: 'done',
              attachmentId: 'final',
              previewAttachmentId: 'partial',
              previewIndex: 1,
              previewUpdatedAt: 2000,
              startedAt: 1000,
              completedAt: 6500,
            },
          ],
        }}
      />,
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('<canvas')
    expect(html).not.toContain('data-active=')
    expect(html).toContain('aria-label="预览模型生成的图片"')
    expect(html).not.toContain('/api/attachments/partial')
    expect(html).toContain('耗时 5s')
    expect(html).not.toContain('实时预览')
    expect(html).not.toContain('玩贪吃蛇')
  })

  it('restores a final image from persisted content and keeps its image-edit action', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage
        live={{
          ...initialLive(),
          imageStatus: 'generating',
          imagePreviewAttachmentId: 'partial',
          imageRevisedPrompt: '中间预览说明',
        }}
        completedImages={[
          {
            type: 'image_result',
            attachment_id: 'persisted-final',
            revised_prompt: '已保存的最终图片说明',
          },
        ]}
        onUseImageSource={() => {}}
      />,
    )
    expect(html).toContain('已完成')
    expect(html).toContain('aria-label="预览模型生成的图片"')
    expect(html).toContain('title="已保存的最终图片说明"')
    expect(html).toContain('以此图编辑')
    expect(html).not.toContain('中间预览说明')
    expect(html).not.toContain('实时预览')
    expect(html).not.toContain('玩贪吃蛇')
    expect(html).not.toContain('<img')
    expect(html).toContain('<canvas')
    expect(html).not.toContain('data-active=')
  })

  it('orders concurrent image statuses and retains the completed state', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage
        live={{
          ...initialLive(),
          imageGenerations: [
            {
              id: 'second',
              index: 1,
              outputIndex: null,
              status: 'generating',
              previewIndex: null,
              previewUpdatedAt: null,
              startedAt: 1000,
              completedAt: null,
            },
            {
              id: 'first',
              index: 0,
              outputIndex: null,
              status: 'done',
              attachmentId: 'first-final',
              previewIndex: null,
              previewUpdatedAt: null,
              startedAt: 1000,
              completedAt: 5000,
            },
          ],
        }}
      />,
    )
    expect(html.indexOf('图 1 完成')).toBeLessThan(html.indexOf('图 2 · 生成中'))
    expect(html).toContain('玩贪吃蛇')
  })

  it('matches persisted final images by attachment ID when they finish in reverse order', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage
        live={{
          ...initialLive(),
          status: 'completed',
          imageGenerations: ['final-a', 'final-b'].map((attachmentId, index) => ({
            id: `generation-${index}`,
            index,
            outputIndex: null,
            status: 'done' as const,
            attachmentId,
            previewIndex: null,
            previewUpdatedAt: null,
            startedAt: 1000,
            completedAt: index === 0 ? 6000 : 4000,
          })),
        }}
        completedImages={[
          {
            type: 'image_result',
            attachment_id: 'final-b',
            revised_prompt: '第二张最终图片说明',
          },
          {
            type: 'image_result',
            attachment_id: 'final-a',
            revised_prompt: '第一张最终图片说明',
          },
        ]}
      />,
    )
    const firstCardStart = html.indexOf('图 1 完成')
    const secondCardStart = html.indexOf('图 2 完成')
    expect(firstCardStart).toBeGreaterThan(-1)
    expect(secondCardStart).toBeGreaterThan(firstCardStart)
    const firstCard = html.slice(firstCardStart, secondCardStart)
    const secondCard = html.slice(secondCardStart)
    expect(firstCard).toContain('title="第一张最终图片说明"')
    expect(firstCard).not.toContain('第二张最终图片说明')
    expect(secondCard).toContain('title="第二张最终图片说明"')
    expect(secondCard).not.toContain('第一张最终图片说明')
  })

  it('pauses visual generation activity while waiting for a retry', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage
        live={{
          ...initialLive(),
          imageStatus: 'generating',
          retry: {
            phase: 'waiting',
            attempt: 2,
            maxAttempts: 4,
            nextRetryAt: 10000,
            reason: '暂时不可用',
          },
        }}
      />,
    )
    expect(html).toContain('等待重试')
    expect(html).not.toContain('data-active=')
  })

  it('removes the empty canvas after a generation stops without a preview', () => {
    const html = renderToStaticMarkup(
      <ProgressiveImageStage
        live={{ ...initialLive(), status: 'canceled', imageStatus: 'generating' }}
      />,
    )
    expect(html).toContain('已停止')
    expect(html).not.toContain('hc-image-waiting-field')
    expect(html).not.toContain('hc-image-stage-body')
  })

  it('starts the optional game paused with accessible controls', () => {
    const html = renderToStaticMarkup(<ImageWaitingGame />)
    expect(html).toContain('开始游戏')
    expect(html).toContain('aria-label="贪吃蛇游戏区域"')
    expect(html).toContain('aria-label="向左"')
    expect(html).toContain('aria-label="暂停游戏"')
    expect(html).toContain('tabindex="0"')
  })
})
