import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialLive } from '../sse/eventReducer'
import { ProgressiveImageStage } from './ProgressiveImageStage'

describe('ProgressiveImageStage', () => {
  it('labels partial images as generation stages', () => {
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
  })
})
