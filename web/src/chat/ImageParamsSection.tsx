import { useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import type { ModelDTO } from '@shared/types/api'
import type { ImageOptions } from '@shared/types/domain'
import {
  GIF_FRAME_COUNT_MAX,
  GIF_FRAME_COUNT_MIN,
  GIF_FRAME_DURATION_MAX_MS,
  GIF_FRAME_DURATION_MIN_MS,
  IMAGE_BACKGROUND_LABELS,
  IMAGE_COMPLEXITY_OPTIONS,
  IMAGE_COUNT_MAX,
  IMAGE_MODERATION_LABELS,
  IMAGE_OUTPUT_FORMAT_LABELS,
  IMAGE_PARTIAL_IMAGES_MAX,
  IMAGE_QUALITY_LABELS,
  formatImageSizeLabel,
  formatIsSingleFile,
  formatSupportsCompression,
  formatSupportsTransparency,
  imageModelProfile,
  imageOutputFormats,
  imageSizeChoice,
  imageSizeForChoice,
  imageSizeOptions,
  nearestAspectRatio,
  parseImageSize,
  validateImageSize,
  type ImageResolutionId,
} from '@shared/util/imageOptions'
import { useChatPrefs } from '../store/chat'
import { resolveForModel } from './imageOptionsSummary'

/** 比例缩略图：按宽高比绘制小圆角矩形（长边恒定），自动用虚线方框表示「不固定」。 */
function AspectGlyph({ width, height }: { width?: number; height?: number }) {
  const LONG_EDGE_PX = 14
  let w = 11
  let h = 11
  if (width && height) {
    const ratio = width / height
    w = ratio >= 1 ? LONG_EDGE_PX : Math.max(6, Math.round(LONG_EDGE_PX * ratio))
    h = ratio >= 1 ? Math.max(6, Math.round(LONG_EDGE_PX / ratio)) : LONG_EDGE_PX
  }
  return (
    <span aria-hidden className="flex h-4 w-4 items-center justify-center">
      <span
        className={clsx(
          'rounded-[3px] border-[1.5px] border-current',
          !(width && height) && 'border-dashed',
        )}
        style={{ width: w, height: h }}
      />
    </span>
  )
}

const ROW_LABEL_CLASS = 'w-14 shrink-0 text-xs text-neutral-400 dark:text-neutral-500'

function ParamRow({
  label,
  title,
  children,
}: {
  label: string
  title?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center gap-1.5 px-1.5">
      <span className={ROW_LABEL_CLASS} title={title}>
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

interface SegmentOption<T> {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

/** 紧凑分段选择：高亮本次实际会用的值，点击即记为用户选择。 */
function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  sheet,
}: {
  label: string
  value: T | null
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  sheet: boolean
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex min-w-0 flex-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          disabled={option.disabled}
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'min-w-0 flex-1 truncate rounded-md px-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
            sheet ? 'py-1.5' : 'py-1',
            value === option.value
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
              : 'text-neutral-500 enabled:hover:text-neutral-800 dark:text-neutral-400 dark:enabled:hover:text-neutral-200',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-blue-500"
      />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
        {format(value)}
      </span>
    </>
  )
}

/** 自定义宽高：输入后点 ✓ 应用，按当前模型与输出格式校验。 */
function CustomSizeRow({
  size,
  validate,
  onApply,
}: {
  size: string
  validate: (size: string) => ReturnType<typeof validateImageSize>
  onApply: (size: string) => void
}) {
  const parsed = parseImageSize(size)
  const [width, setWidth] = useState(String(parsed?.width ?? 1024))
  const [height, setHeight] = useState(String(parsed?.height ?? 1024))
  const [error, setError] = useState<string | null>(null)
  const inputClass =
    'h-8 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-2 text-center text-sm tabular-nums text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500'
  const apply = () => {
    if (!/^\d+$/.test(width.trim()) || !/^\d+$/.test(height.trim())) {
      setError('宽高必须是整数')
      return
    }
    const result = validate(`${width.trim()}x${height.trim()}`)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    onApply(result.normalizedSize)
  }
  return (
    <>
      <ParamRow label="宽 × 高">
        <input
          value={width}
          onChange={(event) => setWidth(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && apply()}
          inputMode="numeric"
          className={inputClass}
          aria-label="图片宽度"
        />
        <span className="shrink-0 text-xs text-neutral-400">×</span>
        <input
          value={height}
          onChange={(event) => setHeight(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && apply()}
          inputMode="numeric"
          className={inputClass}
          aria-label="图片高度"
        />
        <button
          type="button"
          onClick={apply}
          className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white transition hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500"
          aria-label="应用自定义尺寸"
          title="应用"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </ParamRow>
      {error && <div className="pb-0.5 pl-[4.375rem] pr-1.5 text-xs text-red-500">{error}</div>}
    </>
  )
}

/**
 * 图片模型参数：比例 × 清晰度推出上游支持的最终尺寸，画质常驻；
 * 输出格式、背景、构思、张数、过程预览、内容审核与 GIF 动画参数收进「更多选项」。
 * 每项高亮本次实际会用的值；只把用户点过的项记为覆盖，其余沿用模型默认。
 */
export function ImageParamsSection({ model, sheet }: { model: ModelDTO; sheet: boolean }) {
  const imageOptions = useChatPrefs((s) => s.imageOptions)
  const setImageOptions = useChatPrefs((s) => s.setImageOptions)
  const replaceImageOptions = useChatPrefs((s) => s.replaceImageOptions)
  const [moreOpen, setMoreOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const profile = imageModelProfile(model.modelId)
  const resolved = resolveForModel(model, imageOptions)
  const format = resolved.output_format
  const gif = format === 'gif'
  const singleFile = formatIsSingleFile(format)
  const sizeOptions = imageSizeOptions(profile, gif)
  const choice = imageSizeChoice(resolved.size, profile, gif)
  const showCustom = sizeOptions.customAllowed && (customOpen || choice.ratio === 'custom')
  const activeResolution: ImageResolutionId = choice.resolution ?? sizeOptions.resolutions[0]!.id
  const set = (patch: Partial<ImageOptions>) => setImageOptions(patch)

  const selectRatio = (ratio: string) => {
    setCustomOpen(false)
    set({ size: ratio === 'auto' ? 'auto' : imageSizeForChoice(ratio, activeResolution) })
  }
  const selectResolution = (resolution: ImageResolutionId) => {
    const ratio =
      choice.ratio === 'custom'
        ? (nearestAspectRatio(resolved.size, sizeOptions.ratios) ?? '1:1')
        : choice.ratio
    setCustomOpen(false)
    set({ size: imageSizeForChoice(ratio, resolution) })
  }

  const sizeHint =
    resolved.size === 'auto'
      ? '由模型决定'
      : `${gif ? '每帧 ' : ''}${formatImageSizeLabel(resolved.size)}`
  const hasOverrides = Object.keys(imageOptions).length > 0
  const ratioCellClass = (selected: boolean) =>
    clsx(
      'flex min-w-0 items-center justify-center gap-1 rounded-lg border px-1 text-[11.5px] tabular-nums transition',
      sheet ? 'py-2' : 'py-1.5',
      selected
        ? 'border-neutral-300 bg-neutral-100 text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100'
        : 'border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
    )

  return (
    <div className="shrink-0 space-y-1 p-1.5">
      <div className="flex items-center justify-between gap-2 px-3 pt-1">
        <div className="text-xs font-medium text-neutral-400 dark:text-neutral-500">比例</div>
        <div className="flex items-center gap-1.5">
          <span
            className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
            data-testid="image-final-size"
          >
            {sizeHint}
          </span>
          {hasOverrides && (
            <button
              type="button"
              onClick={() => {
                replaceImageOptions({})
                setCustomOpen(false)
              }}
              title="恢复为模型默认参数"
              aria-label="恢复为模型默认参数"
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1 px-1.5">
        <button
          type="button"
          onClick={() => selectRatio('auto')}
          aria-pressed={choice.ratio === 'auto' && !customOpen}
          className={ratioCellClass(choice.ratio === 'auto' && !customOpen)}
          title="由模型根据内容选择比例与尺寸"
        >
          <AspectGlyph />
          自动
        </button>
        {sizeOptions.ratios.map((ratio) => {
          const selected = choice.ratio === ratio.id && !customOpen
          return (
            <button
              key={ratio.id}
              type="button"
              onClick={() => selectRatio(ratio.id)}
              aria-pressed={selected}
              className={ratioCellClass(selected)}
            >
              <AspectGlyph width={ratio.width} height={ratio.height} />
              {ratio.id}
            </button>
          )
        })}
        {sizeOptions.customAllowed && (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            aria-pressed={showCustom}
            className={ratioCellClass(showCustom)}
          >
            自定义
          </button>
        )}
      </div>
      {showCustom && (
        <CustomSizeRow
          key={`${resolved.size}-${format}`}
          size={resolved.size}
          validate={(size) =>
            validateImageSize(size, profile, gif ? { frameCount: resolved.frame_count! } : null)
          }
          onApply={(size) => {
            setCustomOpen(false)
            set({ size })
          }}
        />
      )}
      {sizeOptions.resolutions.length > 1 && (
        <ParamRow label="清晰度">
          <Segmented
            label="清晰度"
            sheet={sheet}
            value={choice.resolution}
            onChange={selectResolution}
            options={sizeOptions.resolutions.map((resolution) => ({
              value: resolution.id,
              label: resolution.label,
              title: resolution.description,
              // 自动尺寸由模型决定像素量，清晰度无从指定。
              disabled: choice.ratio === 'auto' && !customOpen,
            }))}
          />
        </ParamRow>
      )}
      <ParamRow label="画质">
        <Segmented
          label="画质"
          sheet={sheet}
          value={resolved.quality}
          onChange={(quality) => set({ quality })}
          options={profile.qualities.map((quality) => ({
            value: quality,
            label: IMAGE_QUALITY_LABELS[quality],
          }))}
        />
      </ParamRow>

      <button
        type="button"
        onClick={() => setMoreOpen((open) => !open)}
        aria-expanded={moreOpen}
        className="flex w-full items-center gap-1 rounded-lg px-3 py-1 text-xs text-neutral-400 transition hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
      >
        更多选项
        <span className="min-w-0 flex-1 truncate text-left text-neutral-400/80 dark:text-neutral-500/80">
          {moreOpen
            ? ''
            : ` · ${IMAGE_OUTPUT_FORMAT_LABELS[format]} · 审核${IMAGE_MODERATION_LABELS[resolved.moderation]}${
                resolved.partial_images > 0 ? ` · 预览 ${resolved.partial_images} 张` : ''
              }`}
        </span>
        <ChevronDown
          className={clsx('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-180')}
        />
      </button>

      {moreOpen && (
        <div className="space-y-1">
          <ParamRow label="格式">
            <Segmented
              label="输出格式"
              sheet={sheet}
              value={format}
              onChange={(output_format) => {
                setCustomOpen(false)
                set({ output_format })
              }}
              options={imageOutputFormats(profile).map((value) => ({
                value,
                label: IMAGE_OUTPUT_FORMAT_LABELS[value],
                title:
                  value === 'gif'
                    ? '输出动图，可在下方设置帧数与每帧时长'
                    : value === 'svg'
                      ? '输出矢量图，仅根据文字生成，不能带参考图'
                      : undefined,
              }))}
            />
          </ParamRow>
          {formatSupportsCompression(format) && (
            <ParamRow label="压缩质量" title="数值越低文件越小，100 为最高质量">
              <Slider
                label="压缩质量"
                value={resolved.output_compression ?? 100}
                min={0}
                max={100}
                step={5}
                format={(value) => `${value}`}
                onChange={(output_compression) => set({ output_compression })}
              />
            </ParamRow>
          )}
          {gif && (
            <>
              <ParamRow label="帧数">
                <Slider
                  label="帧数"
                  value={resolved.frame_count!}
                  min={GIF_FRAME_COUNT_MIN}
                  max={GIF_FRAME_COUNT_MAX}
                  step={1}
                  format={(value) => `${value} 帧`}
                  onChange={(frame_count) => set({ frame_count })}
                />
              </ParamRow>
              <ParamRow label="每帧时长">
                <Slider
                  label="每帧时长"
                  value={resolved.frame_duration_ms!}
                  min={GIF_FRAME_DURATION_MIN_MS}
                  max={GIF_FRAME_DURATION_MAX_MS}
                  step={10}
                  format={(value) => `${value} ms`}
                  onChange={(frame_duration_ms) => set({ frame_duration_ms })}
                />
              </ParamRow>
            </>
          )}
          <ParamRow label="背景">
            <Segmented
              label="背景"
              sheet={sheet}
              value={resolved.background}
              onChange={(background) => set({ background })}
              options={(['auto', 'opaque', 'transparent'] as const).map((value) => ({
                value,
                label: IMAGE_BACKGROUND_LABELS[value],
                disabled: value === 'transparent' && !formatSupportsTransparency(format),
                title:
                  value === 'transparent' && !formatSupportsTransparency(format)
                    ? '透明背景需要 PNG 或 WebP 格式'
                    : undefined,
              }))}
            />
          </ParamRow>
          {profile.complexity && (
            <ParamRow label="构思" title="生成前规划画面的程度，与画质相互独立；简单修改可选低">
              <Segmented
                label="构思"
                sheet={sheet}
                value={resolved.complexity ?? 'auto'}
                onChange={(complexity) =>
                  set({ complexity: complexity === 'auto' ? undefined : complexity })
                }
                options={[{ value: 'auto' as const, label: '自动' }, ...IMAGE_COMPLEXITY_OPTIONS]}
              />
            </ParamRow>
          )}
          <ParamRow label="张数">
            <Segmented
              label="张数"
              sheet={sheet}
              value={resolved.n}
              onChange={(n) => set({ n })}
              options={Array.from({ length: IMAGE_COUNT_MAX }, (_, index) => ({
                value: index + 1,
                label: String(index + 1),
                disabled: singleFile && index > 0,
                title: singleFile && index > 0 ? 'GIF 与 SVG 每次生成一张' : undefined,
              }))}
            />
          </ParamRow>
          <ParamRow label="过程预览" title="生成过程中先显示几张逐步清晰的预览图">
            <Segmented
              label="过程预览"
              sheet={sheet}
              value={resolved.partial_images}
              onChange={(partial_images) => set({ partial_images })}
              options={Array.from({ length: IMAGE_PARTIAL_IMAGES_MAX + 1 }, (_, count) => ({
                value: count,
                label: count === 0 ? '关' : `${count} 张`,
                disabled: count > 0 && (singleFile || resolved.n > 1),
                title:
                  count > 0 && (singleFile || resolved.n > 1)
                    ? '一次生成多张或输出 GIF / SVG 时不提供过程预览'
                    : undefined,
              }))}
            />
          </ParamRow>
          <ParamRow label="内容审核">
            <Segmented
              label="内容审核"
              sheet={sheet}
              value={resolved.moderation}
              onChange={(moderation) => set({ moderation })}
              options={(['low', 'auto'] as const).map((value) => ({
                value,
                label: IMAGE_MODERATION_LABELS[value],
              }))}
            />
          </ParamRow>
        </div>
      )}
    </div>
  )
}
