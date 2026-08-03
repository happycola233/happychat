import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { clsx } from 'clsx'

/** 所有颜色选择器共用的自定义取色入口，避免各业务组件重复手写渐变。 */
export const CUSTOM_COLOR_SWATCH_BACKGROUND =
  'conic-gradient(#ef4444, #f59e0b, #22c55e, #0ea5e9, #8b5cf6, #ec4899, #ef4444)'

type ColorControlSurface = 'dialog' | 'panel'

const RING_OFFSET_CLASS: Record<ColorControlSurface, string> = {
  dialog: 'ring-offset-white dark:ring-offset-neutral-900',
  panel: 'ring-offset-neutral-50 dark:ring-offset-neutral-800',
}

type ColorButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-pressed'>

/**
 * 圆形颜色样本的唯一实现。
 *
 * `conic-gradient` 默认以 padding box 为定位区域，却会绘制到 border box；如果色块带
 * 半透明边框，四边就可能露出渐变另一侧的颜色。这里同时用 class 与行内样式锁死无边框，
 * 并把背景定位、裁切和重复方式显式化，防止业务组件再次把这个历史回归带回来。
 */
export function ColorSwatch({
  selected,
  showSelectedRing = true,
  surface = 'dialog',
  className,
  style,
  children,
  ...props
}: ColorButtonProps & {
  selected: boolean
  /** 文件夹色板沿用“勾即选中”的既有外观时可关闭常驻外环。 */
  showSelectedRing?: boolean
  surface?: ColorControlSurface
  children?: ReactNode
}) {
  const protectedBackgroundStyle: CSSProperties = {
    ...style,
    borderWidth: 0,
    backgroundOrigin: 'border-box',
    backgroundClip: 'border-box',
    backgroundRepeat: 'no-repeat',
  }

  return (
    <button
      {...props}
      type="button"
      aria-pressed={selected}
      style={protectedBackgroundStyle}
      className={clsx(
        'relative flex h-7 w-7 shrink-0 appearance-none items-center justify-center rounded-full border-0 transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2',
        RING_OFFSET_CLASS[surface],
        selected && showSelectedRing && 'ring-2 ring-sky-500 ring-offset-2 dark:ring-sky-400',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** “自动 / 默认”并不是一种颜色，统一使用带文字的胶囊表达空值语义。 */
export function ColorModeButton({
  selected,
  surface = 'dialog',
  className,
  children,
  ...props
}: ColorButtonProps & {
  selected: boolean
  surface?: ColorControlSurface
  children: ReactNode
}) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={selected}
      className={clsx(
        'flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2',
        RING_OFFSET_CLASS[surface],
        selected
          ? 'border-sky-500 bg-sky-50 text-sky-600 dark:border-sky-400 dark:bg-sky-400/15 dark:text-sky-300'
          : 'border-neutral-300 bg-white text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-500 dark:hover:text-neutral-200',
        className,
      )}
    >
      {children}
    </button>
  )
}
