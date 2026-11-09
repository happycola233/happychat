import type { ModelDTO } from '@shared/types/api'
import type { ImageOptions } from '@shared/types/domain'
import {
  IMAGE_OUTPUT_FORMAT_LABELS,
  formatImageSizeLabel,
  imageModelProfile,
  imageSizeChoice,
  imageSizeOptions,
  resolveImageOptions,
  type ResolvedImageOptions,
} from '@shared/util/imageOptions'

/** 当前模型下本次请求实际会用的生图参数（用户覆盖 → 管理员默认 → 内置默认）。 */
export function resolveForModel(model: ModelDTO, overrides: ImageOptions): ResolvedImageOptions {
  return resolveImageOptions(
    imageModelProfile(model.modelId),
    model.defaultParams?.image,
    overrides,
    {
      editing: false,
    },
  )
}

/** 触发器上的简短摘要，例如「16:9 2K」「GIF」；全部沿用自动时返回 null。 */
export function imageOptionsSummary(model: ModelDTO, overrides: ImageOptions): string | null {
  const profile = imageModelProfile(model.modelId)
  const options = resolveForModel(model, overrides)
  const gif = options.output_format === 'gif'
  const choice = imageSizeChoice(options.size, profile, gif)
  const resolution = imageSizeOptions(profile, gif).resolutions.find(
    (item) => item.id === choice.resolution,
  )
  const parts = [
    choice.ratio === 'custom'
      ? formatImageSizeLabel(options.size)
      : choice.ratio === 'auto'
        ? null
        : choice.ratio,
    // 标准尺寸模型只有 1K，一档时不必赘述。
    resolution && profile.flexibleSize ? resolution.label : null,
    options.output_format === 'png' ? null : IMAGE_OUTPUT_FORMAT_LABELS[options.output_format],
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}
