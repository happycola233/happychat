import type { ImageGenerationDetails } from '@shared/types/domain'
import {
  IMAGE_BACKGROUND_LABELS,
  IMAGE_COMPLEXITY_OPTIONS,
  IMAGE_MODERATION_LABELS,
  IMAGE_OUTPUT_FORMAT_LABELS,
  IMAGE_QUALITY_LABELS,
  formatImageSizeLabel,
  imageSizePreset,
} from '@shared/util/imageOptions'
import { formatDuration } from '../lib/format'

export interface ImageDetailRow {
  label: string
  value: string
}

/** 枚举值转中文；上游将来新增的值原样显示，不丢信息。 */
function labelOf(labels: Record<string, string>, value: string | undefined): string | undefined {
  return value === undefined ? undefined : (labels[value] ?? value)
}

/** 请求为「自动」时附上上游回显的实际值，例如「自动 → 高」。 */
function withActual(requested: string | undefined, actual: string | undefined): string | undefined {
  if (requested !== undefined && requested !== '自动') return requested
  if (actual !== undefined && actual !== '自动') return `自动 → ${actual}`
  return requested
}

function sizeLabel(size: string | undefined, gif: boolean): string | undefined {
  if (size === undefined) return undefined
  if (size === 'auto') return '自动'
  const preset = imageSizePreset(size, gif)
  const pixels = formatImageSizeLabel(size)
  return preset ? `${preset.ratio} · ${preset.resolution}（${pixels}）` : pixels
}

const COMPLEXITY_LABELS = Object.fromEntries(
  IMAGE_COMPLEXITY_OPTIONS.map((option) => [option.value, option.label]),
)

/** 生成详情浮层的行；只列出快照里存在的项，旧快照或 Responses 工具缺失的字段自然省略。 */
export function imageGenerationDetailRows(details: ImageGenerationDetails): ImageDetailRow[] {
  const { request, result } = details
  const format = request.output_format ?? result.output_format
  const gif = format === 'gif'
  const rows: (ImageDetailRow | null)[] = [
    details.operation
      ? {
          label: '方式',
          value:
            details.operation === 'generate'
              ? '根据文字生成'
              : (details.inputImageCount ?? 0) > 1
                ? `修改图片（共 ${details.inputImageCount} 张输入图，第 1 张为主图）`
                : '修改图片',
        }
      : null,
  ]
  const push = (label: string, value: string | undefined) => {
    if (value !== undefined) rows.push({ label, value })
  }
  push(
    gif ? '每帧尺寸' : '尺寸',
    withActual(sizeLabel(request.size, gif), sizeLabel(result.size, gif)),
  )
  push(
    '画质',
    withActual(
      labelOf(IMAGE_QUALITY_LABELS, request.quality),
      labelOf(IMAGE_QUALITY_LABELS, result.quality),
    ),
  )
  const formatLabel = labelOf(IMAGE_OUTPUT_FORMAT_LABELS, format)
  push(
    '格式',
    formatLabel &&
      (request.output_compression !== undefined && (format === 'jpeg' || format === 'webp')
        ? `${formatLabel} · 压缩质量 ${request.output_compression}`
        : formatLabel),
  )
  if (gif && request.frame_count !== undefined)
    push(
      '动画',
      `${request.frame_count} 帧${
        request.frame_duration_ms === undefined ? '' : ` · 每帧 ${request.frame_duration_ms} ms`
      }`,
    )
  push(
    '背景',
    withActual(
      labelOf(IMAGE_BACKGROUND_LABELS, request.background),
      labelOf(IMAGE_BACKGROUND_LABELS, result.background),
    ),
  )
  push('构思', labelOf(COMPLEXITY_LABELS, request.complexity))
  if (request.n !== undefined && request.n > 1) push('张数', `${request.n} 张`)
  if (request.partial_images !== undefined)
    push('过程预览', request.partial_images > 0 ? `${request.partial_images} 张` : '关闭')
  push('内容审核', labelOf(IMAGE_MODERATION_LABELS, request.moderation))
  if (details.durationMs !== null) push('用时', formatDuration(details.durationMs))
  return rows.filter((row): row is ImageDetailRow => row !== null)
}
