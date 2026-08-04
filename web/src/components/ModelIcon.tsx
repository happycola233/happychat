import type { CSSProperties } from 'react'
import { clsx } from 'clsx'
import { Folder } from 'lucide-react'
import type { ModelIcon as ModelIconValue, ModelIconAsset } from '@shared/types/domain'
import { LOBE_ICON_SLUG_PATTERN } from '@shared/util/modelIcon'
import { resolveModelGroupColor } from '@shared/util/modelGroupAppearance'
import { guessModelIconSlug } from '@shared/util/modelIconGuess'
import { useLobeIconCatalog } from '../hooks/useModels'
import { ICON_EMOJI_CLASS, ICON_SIZE_CLASS, type IconSize } from './iconSizing'

export type { IconSize } from './iconSizing'

/** 单色品牌图标的默认前景色：小尺寸下保持足够对比，同时避免纯黑抢过名称。 */
export const DEFAULT_MODEL_ICON_TONE_CLASS = 'text-neutral-700 dark:text-neutral-300'

/**
 * 首字母是低细节图形，需要比同档 SVG 略大的视觉面积才显得等重。
 * 外层仍占标准图标槽位，内层只做光学放大，因此列表名称不会左右错位。
 */
const INITIAL_VISUAL_CLASS: Record<IconSize, string> = {
  xs: 'h-4 w-4 rounded-[4px] text-[10px]',
  sm: 'h-5 w-5 rounded-[5px] text-xs',
  md: 'h-6 w-6 rounded-md text-sm',
  lg: 'h-7 w-7 rounded-lg text-base',
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 外显名优先、模型 ID 兜底；空草稿没有首字母，不能再显示含义不明的点号。 */
function modelInitial(modelId?: string, displayName?: string): string | null {
  const source = displayName?.trim() || modelId?.trim() || ''
  const first = graphemeSegmenter.segment(source)[Symbol.iterator]().next().value?.segment
  return first ? first.toLocaleUpperCase() : null
}

function lobeIconUrl(slug: string, version?: string, theme?: 'light' | 'dark'): string {
  const params = new URLSearchParams()
  if (version) params.set('v', version)
  if (theme) params.set('theme', theme)
  const query = params.toString()
  return `/api/model-icons/lobe/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`
}

function customIconUrl(id: string): string {
  return `/api/model-icons/custom/${encodeURIComponent(id)}`
}

/**
 * 内置图标未加载到目录时的兜底判定：`-color` / `-brand` 后缀基本都含固定品牌色。
 * 只用于目录到达前的首帧，目录到达后一律以服务端扫描出的精确 mono 标记为准
 * （少数 `-color` 图标内部其实也用 currentColor，纯靠后缀会判错）。
 */
function guessMono(slug: string): boolean {
  return !/-(color|brand)$/.test(slug)
}

/**
 * 模型 / 分组图标的裸图形（不带芯片底色）。
 *
 * 五条渲染路径：
 * - 内置单色图标 → CSS mask + currentColor，随主题与 hover 态自动变色；
 * - 内置彩色图标 → 按明暗主题请求服务端着色后的 background image；
 * - 自定义上传 → `<img>`；
 * - Emoji → 直接渲染字符。
 * - 显式 initial → 跳过自动品牌识别，直接使用名称首字母。
 * 都没有时按 modelId 自动识别品牌图标，仍认不出才退到首字母色块；空草稿不渲染伪首字母。
 */
export function ModelIconMark({
  icon,
  modelId,
  displayName,
  size = 'sm',
  className,
}: {
  icon: ModelIconValue | null
  /** 用于自动识别品牌图标；分组等没有 modelId 的场景可不传。 */
  modelId?: string
  /** 认不出图标时取首字符做兜底。 */
  displayName?: string
  size?: IconSize
  className?: string
}) {
  const { data: catalog } = useLobeIconCatalog()

  // 未显式配置图标时按 modelId 猜一个品牌图标：管理员什么都不配也能开箱即用地看到品牌标识，
  // 管理端的「批量识别图标」只是把同一份猜测固化成可编辑的显式值。
  const guessedSlug = icon ? null : modelId ? guessModelIconSlug(modelId, displayName) : null
  const resolved: ModelIconAsset | null =
    icon && icon.type !== 'initial'
      ? icon
      : !icon && guessedSlug
        ? { type: 'lobe', slug: guessedSlug }
        : null

  if (resolved?.type === 'emoji') {
    return (
      <span
        aria-hidden
        className={clsx(
          'flex shrink-0 items-center justify-center leading-none',
          ICON_SIZE_CLASS[size],
          ICON_EMOJI_CLASS[size],
          className,
        )}
      >
        {resolved.char}
      </span>
    )
  }

  if (resolved?.type === 'lobe' && LOBE_ICON_SLUG_PATTERN.test(resolved.slug)) {
    const mono = catalog?.monoBySlug[resolved.slug] ?? guessMono(resolved.slug)
    if (mono) {
      return (
        <span
          aria-hidden
          className={clsx('shrink-0', ICON_SIZE_CLASS[size], 'hc-icon-mask', className)}
          style={
            {
              '--hc-icon-url': `url("${lobeIconUrl(resolved.slug, catalog?.version)}")`,
            } as CSSProperties
          }
        />
      )
    }
    const colorIconClass = 'shrink-0 bg-contain bg-center bg-no-repeat'
    return (
      <>
        <span
          aria-hidden
          className={clsx(colorIconClass, 'block dark:hidden', ICON_SIZE_CLASS[size], className)}
          style={{
            backgroundImage: `url("${lobeIconUrl(resolved.slug, catalog?.version, 'light')}")`,
          }}
        />
        <span
          aria-hidden
          className={clsx(colorIconClass, 'hidden dark:block', ICON_SIZE_CLASS[size], className)}
          style={{
            backgroundImage: `url("${lobeIconUrl(resolved.slug, catalog?.version, 'dark')}")`,
          }}
        />
      </>
    )
  }

  if (resolved?.type === 'custom') {
    return (
      <img
        aria-hidden
        alt=""
        loading="lazy"
        src={customIconUrl(resolved.id)}
        className={clsx('shrink-0 rounded-[3px] object-contain', ICON_SIZE_CLASS[size], className)}
      />
    )
  }

  const initial = modelInitial(modelId, displayName)
  if (!initial) return null
  return (
    <span
      aria-hidden
      className={clsx(
        'relative shrink-0',
        DEFAULT_MODEL_ICON_TONE_CLASS,
        ICON_SIZE_CLASS[size],
        className,
      )}
    >
      <span
        className={clsx(
          'absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center font-semibold leading-none',
          'bg-neutral-200 dark:bg-neutral-700',
          INITIAL_VISUAL_CLASS[size],
        )}
      >
        {initial}
      </span>
    </span>
  )
}

/**
 * 分组裸图标：按管理员图标或默认文件夹图形本身的尺寸占位。
 * 颜色只属于默认文件夹图形，并直接使用管理员选中的原色；显式图标使用自身外观。
 */
export function ModelGroupGlyph({
  group,
  size = 'sm',
  className,
}: {
  group: { name?: string; icon: ModelIconAsset | null; color: string | null }
  size?: IconSize
  className?: string
}) {
  const effectiveColor = resolveModelGroupColor(group.icon, group.color)
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex shrink-0 items-center justify-center leading-none',
        ICON_SIZE_CLASS[size],
        effectiveColor ? undefined : DEFAULT_MODEL_ICON_TONE_CLASS,
        className,
      )}
      style={effectiveColor ? { color: effectiveColor } : undefined}
    >
      {group.icon ? (
        <ModelIconMark icon={group.icon} size={size} />
      ) : (
        // fill=currentColor 让默认文件夹保持清晰的实心轮廓。
        <Folder className="h-full w-full" fill="currentColor" strokeWidth={1} />
      )}
    </span>
  )
}
