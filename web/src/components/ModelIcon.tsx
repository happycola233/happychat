import type { CSSProperties } from 'react'
import { clsx } from 'clsx'
import { Folder } from 'lucide-react'
import type { ModelIcon as ModelIconValue } from '@shared/types/domain'
import { LOBE_ICON_SLUG_PATTERN } from '@shared/util/modelIcon'
import { resolveModelGroupColor } from '@shared/util/modelGroupAppearance'
import { guessModelIconSlug } from '@shared/util/modelIconGuess'
import { useLobeIconCatalog } from '../hooks/useModels'
import { ICON_EMOJI_CLASS, ICON_SIZE_CLASS, type IconSize } from './iconSizing'

export type { IconSize } from './iconSizing'

/** 无图标时的文字兜底：字号要比图标本身小一档才不会显得挤。 */
const FALLBACK_TEXT_CLASS: Record<IconSize, string> = {
  xs: 'text-[8px]',
  sm: 'text-[9px]',
  md: 'text-[10px]',
  lg: 'text-[11px]',
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
 * 三条渲染路径：
 * - 内置单色图标 → CSS mask + currentColor，随主题与 hover 态自动变色；
 * - 内置彩色图标 → 按明暗主题请求服务端着色后的 background image；
 * - 自定义上传 → `<img>`；
 * - Emoji → 直接渲染字符。
 * 都没有时按 modelId 自动识别品牌图标，仍认不出才退到首字母色块。
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
  const resolved: ModelIconValue | null =
    icon ?? (guessedSlug ? { type: 'lobe', slug: guessedSlug } : null)

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

  const initial = displayName?.trim().charAt(0).toUpperCase() || '·'
  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-[4px] font-semibold leading-none',
        'bg-neutral-200/70 text-neutral-500 dark:bg-neutral-700/60 dark:text-neutral-300',
        ICON_SIZE_CLASS[size],
        FALLBACK_TEXT_CLASS[size],
        className,
      )}
    >
      {initial}
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
  group: { name?: string; icon: ModelIconValue | null; color: string | null }
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
        effectiveColor ? undefined : 'text-neutral-500 dark:text-neutral-300',
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
