import type { ImageOptions } from '@shared/types/domain'
import {
  GIF_FRAME_COUNT_MAX,
  GIF_FRAME_COUNT_MIN,
  GIF_FRAME_DURATION_MAX_MS,
  GIF_FRAME_DURATION_MIN_MS,
  IMAGE_BACKGROUND_LABELS,
  IMAGE_BUILTIN_DEFAULTS,
  IMAGE_COMPLEXITY_OPTIONS,
  IMAGE_COUNT_MAX,
  IMAGE_MODERATION_LABELS,
  IMAGE_OUTPUT_FORMAT_LABELS,
  IMAGE_PARTIAL_IMAGES_MAX,
  IMAGE_QUALITY_LABELS,
  formatImageSizeLabel,
  imageModelProfile,
  imageOutputFormats,
  imageSizeForChoice,
  imageSizeOptions,
} from '@shared/util/imageOptions'
import { inputClass } from '../../components/ui/controlStyles'
import { Select, type SelectOption } from '../../components/ui/Select'
import { SmallField } from './FormField'

const fieldClass = `${inputClass} tabular-nums`

function intOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const number = Number(value)
  return Number.isInteger(number) ? number : undefined
}

/**
 * 生图模型默认参数：用户在模型菜单里没改过的项使用这里的值，留空沿用本站内置默认。
 * 可选项随模型 ID 推断的能力变化（如 2.6 才有 GIF / SVG / 构思）。
 */
export function ImageDefaultParamsEditor({
  modelId,
  value,
  onChange,
}: {
  modelId: string
  value: ImageOptions
  onChange: (value: ImageOptions) => void
}) {
  const profile = imageModelProfile(modelId)
  const set = <K extends keyof ImageOptions>(key: K, next: ImageOptions[K] | undefined) => {
    const updated: ImageOptions = { ...value, [key]: next }
    if (next === undefined) delete updated[key]
    onChange(updated)
  }
  const builtin = (label: string): SelectOption => ({ value: '', label: `内置默认（${label}）` })
  const gif = value.output_format === 'gif'
  const sizeOptions = imageSizeOptions(profile, gif)
  const sizeChoices: SelectOption[] = [
    builtin('自动'),
    { value: 'auto', label: '自动' },
    ...sizeOptions.ratios.flatMap((ratio) =>
      sizeOptions.resolutions.map((resolution) => {
        const size = imageSizeForChoice(ratio.id, resolution.id)
        return {
          value: size,
          label: `${ratio.id} · ${resolution.label}`,
          description: formatImageSizeLabel(size),
        }
      }),
    ),
  ]
  // 历史上保存的自定义尺寸不在预设里时仍要能显示和保留。
  if (value.size && !sizeChoices.some((option) => option.value === value.size))
    sizeChoices.push({ value: value.size, label: formatImageSizeLabel(value.size) })

  return (
    <div className="grid grid-cols-2 items-end gap-x-3 gap-y-2.5 lg:grid-cols-4">
      <SmallField label={gif ? '每帧尺寸' : '尺寸'}>
        <Select
          className="w-full"
          value={value.size ?? ''}
          options={sizeChoices}
          onChange={(event) => set('size', event.target.value || undefined)}
        />
      </SmallField>
      <SmallField label="画质">
        <Select
          className="w-full"
          value={value.quality ?? ''}
          options={[
            builtin('自动'),
            ...profile.qualities.map((quality) => ({
              value: quality,
              label: IMAGE_QUALITY_LABELS[quality],
              description: quality,
            })),
          ]}
          onChange={(event) =>
            set('quality', (event.target.value || undefined) as ImageOptions['quality'])
          }
        />
      </SmallField>
      <SmallField label="输出格式">
        <Select
          className="w-full"
          value={value.output_format ?? ''}
          options={[
            builtin('PNG'),
            ...imageOutputFormats(profile).map((format) => ({
              value: format,
              label: IMAGE_OUTPUT_FORMAT_LABELS[format],
            })),
          ]}
          onChange={(event) =>
            set('output_format', (event.target.value || undefined) as ImageOptions['output_format'])
          }
        />
      </SmallField>
      <SmallField label="压缩质量（JPEG / WebP）">
        <input
          className={fieldClass}
          type="number"
          min={0}
          max={100}
          step={1}
          value={value.output_compression ?? ''}
          placeholder={String(IMAGE_BUILTIN_DEFAULTS.output_compression)}
          onChange={(event) => set('output_compression', intOrUndefined(event.target.value))}
        />
      </SmallField>
      <SmallField label="背景">
        <Select
          className="w-full"
          value={value.background ?? ''}
          options={[
            builtin('自动'),
            ...(['auto', 'opaque', 'transparent'] as const).map((background) => ({
              value: background,
              label: IMAGE_BACKGROUND_LABELS[background],
            })),
          ]}
          onChange={(event) =>
            set('background', (event.target.value || undefined) as ImageOptions['background'])
          }
        />
      </SmallField>
      <SmallField label="内容审核">
        <Select
          className="w-full"
          value={value.moderation ?? ''}
          options={[
            builtin(IMAGE_MODERATION_LABELS[IMAGE_BUILTIN_DEFAULTS.moderation]),
            ...(['low', 'auto'] as const).map((moderation) => ({
              value: moderation,
              label: IMAGE_MODERATION_LABELS[moderation],
              description: moderation,
            })),
          ]}
          onChange={(event) =>
            set('moderation', (event.target.value || undefined) as ImageOptions['moderation'])
          }
        />
      </SmallField>
      <SmallField label="过程预览">
        <Select
          className="w-full"
          value={value.partial_images === undefined ? '' : String(value.partial_images)}
          options={[
            builtin(`${IMAGE_BUILTIN_DEFAULTS.partial_images} 张`),
            ...Array.from({ length: IMAGE_PARTIAL_IMAGES_MAX + 1 }, (_, count) => ({
              value: String(count),
              label: count === 0 ? '关闭' : `${count} 张`,
            })),
          ]}
          onChange={(event) => set('partial_images', intOrUndefined(event.target.value))}
        />
      </SmallField>
      <SmallField label="张数">
        <Select
          className="w-full"
          value={value.n === undefined ? '' : String(value.n)}
          options={[
            builtin(`${IMAGE_BUILTIN_DEFAULTS.n} 张`),
            ...Array.from({ length: IMAGE_COUNT_MAX }, (_, index) => ({
              value: String(index + 1),
              label: `${index + 1} 张`,
            })),
          ]}
          onChange={(event) => set('n', intOrUndefined(event.target.value))}
        />
      </SmallField>
      {profile.complexity && (
        <SmallField label="构思">
          <Select
            className="w-full"
            value={value.complexity ?? ''}
            options={[
              builtin('模型默认'),
              ...IMAGE_COMPLEXITY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                description: option.value,
              })),
            ]}
            onChange={(event) =>
              set('complexity', (event.target.value || undefined) as ImageOptions['complexity'])
            }
          />
        </SmallField>
      )}
      {profile.gif && (
        <>
          <SmallField label={`GIF 帧数（${GIF_FRAME_COUNT_MIN}–${GIF_FRAME_COUNT_MAX}）`}>
            <input
              className={fieldClass}
              type="number"
              min={GIF_FRAME_COUNT_MIN}
              max={GIF_FRAME_COUNT_MAX}
              step={1}
              value={value.frame_count ?? ''}
              placeholder={String(IMAGE_BUILTIN_DEFAULTS.frame_count)}
              onChange={(event) => set('frame_count', intOrUndefined(event.target.value))}
            />
          </SmallField>
          <SmallField label="GIF 每帧时长（ms）">
            <input
              className={fieldClass}
              type="number"
              min={GIF_FRAME_DURATION_MIN_MS}
              max={GIF_FRAME_DURATION_MAX_MS}
              step={10}
              value={value.frame_duration_ms ?? ''}
              placeholder={String(IMAGE_BUILTIN_DEFAULTS.frame_duration_ms)}
              onChange={(event) => set('frame_duration_ms', intOrUndefined(event.target.value))}
            />
          </SmallField>
        </>
      )}
    </div>
  )
}
