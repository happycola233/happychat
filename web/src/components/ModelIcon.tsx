import type { CSSProperties } from 'react'
import { clsx } from 'clsx'
import { Folder } from 'lucide-react'
import type { ModelIcon as ModelIconValue } from '@shared/types/domain'
import { LOBE_ICON_SLUG_PATTERN } from '@shared/util/modelIcon'
import { guessModelIconSlug } from '@shared/util/modelIconGuess'
import { useLobeIconCatalog } from '../hooks/useModels'

export type IconSize = 'xs' | 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<IconSize, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

/** 无图标时的文字兜底：字号要比图标本身小一档才不会显得挤。 */
const FALLBACK_TEXT_CLASS: Record<IconSize, string> = {
  xs: 'text-[8px]',
  sm: 'text-[9px]',
  md: 'text-[10px]',
  lg: 'text-[11px]',
}

const CHIP_SIZE_CLASS: Record<IconSize, string> = {
  xs: 'h-5 w-5 rounded-md text-[12px]',
  sm: 'h-6 w-6 rounded-lg text-[14px]',
  md: 'h-8 w-8 rounded-lg text-[17px]',
  lg: 'h-11 w-11 rounded-xl text-[24px]',
}

const CHIP_GLYPH_SIZE: Record<IconSize, IconSize> = { xs: 'xs', sm: 'xs', md: 'sm', lg: 'lg' }

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
          SIZE_CLASS[size],
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
          className={clsx('shrink-0', SIZE_CLASS[size], 'hc-icon-mask', className)}
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
          className={clsx(colorIconClass, 'block dark:hidden', SIZE_CLASS[size], className)}
          style={{
            backgroundImage: `url("${lobeIconUrl(resolved.slug, catalog?.version, 'light')}")`,
          }}
        />
        <span
          aria-hidden
          className={clsx(colorIconClass, 'hidden dark:block', SIZE_CLASS[size], className)}
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
        className={clsx('shrink-0 rounded-[3px] object-contain', SIZE_CLASS[size], className)}
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
        SIZE_CLASS[size],
        FALLBACK_TEXT_CLASS[size],
        className,
      )}
    >
      {initial}
    </span>
  )
}

/**
 * 分组图标芯片：圆角底色块 + 图形，视觉语言与侧边栏聊天文件夹的 FolderGlyph 一致
 * （任意主题色经 color-mix 派生浅底/前景，深色模式自动提亮）。
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
  const style = group.color ? ({ '--hc-icon-color': group.color } as CSSProperties) : undefined
  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 items-center justify-center leading-none',
        CHIP_SIZE_CLASS[size],
        group.color
          ? 'hc-icon-chip'
          : 'bg-neutral-200/70 text-neutral-500 dark:bg-neutral-700/60 dark:text-neutral-300',
        className,
      )}
      style={style}
    >
      {group.icon ? (
        <ModelIconMark icon={group.icon} size={CHIP_GLYPH_SIZE[size]} />
      ) : (
        // fill=currentColor 让 lucide 线框图标变成实心块，作为芯片里的默认图形更醒目。
        <Folder className={SIZE_CLASS[CHIP_GLYPH_SIZE[size]]} fill="currentColor" strokeWidth={1} />
      )}
    </span>
  )
}
