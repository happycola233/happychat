import { describe, expect, it } from 'vitest'
import { imageGenerationDetailRows } from './imageGenerationDetails'

describe('imageGenerationDetailRows', () => {
  it('describes presets, automatic choices resolved by the model and the duration', () => {
    expect(
      imageGenerationDetailRows({
        operation: 'edit',
        inputImageCount: 2,
        request: {
          size: '2560x1440',
          quality: 'auto',
          output_format: 'webp',
          output_compression: 80,
          background: 'auto',
          moderation: 'low',
          partial_images: 3,
          complexity: 'medium',
        },
        result: { size: '2560x1440', quality: 'high', background: 'opaque', output_format: 'webp' },
        durationMs: 34_200,
      }),
    ).toEqual([
      { label: '方式', value: '修改图片（共 2 张输入图，第 1 张为主图）' },
      { label: '尺寸', value: '16:9 · 2K（2560×1440）' },
      { label: '画质', value: '自动 → 高' },
      { label: '格式', value: 'WebP · 压缩质量 80' },
      { label: '背景', value: '自动 → 不透明' },
      { label: '构思', value: '中' },
      { label: '过程预览', value: '3 张' },
      { label: '内容审核', value: '宽松' },
      { label: '用时', value: '34s' },
    ])
  })

  it('shows GIF frame settings and omits fields the snapshot does not have', () => {
    expect(
      imageGenerationDetailRows({
        request: { size: '512x512', output_format: 'gif', frame_count: 12, frame_duration_ms: 120 },
        result: {},
        durationMs: null,
      }),
    ).toEqual([
      { label: '每帧尺寸', value: '1:1 · 标准（512×512）' },
      { label: '格式', value: 'GIF' },
      { label: '动画', value: '12 帧 · 每帧 120 ms' },
    ])
  })
})
