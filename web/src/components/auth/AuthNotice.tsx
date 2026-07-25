import { clsx } from 'clsx'
import type { ComponentType, ReactNode } from 'react'
import { CircleAlert, Info, ShieldCheck } from 'lucide-react'

type Tone = 'error' | 'info' | 'highlight'

/** 三种语气各自的配色与默认图标：错误(玫红) / 说明(中性) / 需要注意的好消息(琥珀)。 */
const TONE_STYLES: Record<
  Tone,
  { box: string; icon: string; glyph: ComponentType<{ className?: string }> }
> = {
  error: {
    box: 'border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300',
    icon: 'text-rose-500 dark:text-rose-400',
    glyph: CircleAlert,
  },
  info: {
    box: 'border-black/[0.07] bg-white/70 text-neutral-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-neutral-300',
    icon: 'text-neutral-400 dark:text-neutral-500',
    glyph: Info,
  },
  highlight: {
    box: 'border-amber-200/80 bg-amber-50/80 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200',
    icon: 'text-amber-500 dark:text-amber-400',
    glyph: ShieldCheck,
  },
}

/**
 * 登录 / 注册页的提示条：提交错误、首位管理员提示、站点未初始化引导共用一套排版，
 * 保证同一张卡片里不会出现三种粗细不一的提示样式。
 * 错误语气带 `role="alert"`，读屏会在提交失败时立刻播报。
 */
export function AuthNotice({
  tone = 'info',
  icon,
  children,
  className,
}: {
  tone?: Tone
  /** 覆盖默认图标（如首位管理员用盾牌、未初始化用信息图标）。 */
  icon?: ComponentType<{ className?: string }>
  children: ReactNode
  className?: string
}) {
  const style = TONE_STYLES[tone]
  const Glyph = icon ?? style.glyph

  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={clsx(
        'hc-anim-in flex gap-2.5 rounded-2xl border px-3.5 py-3 text-[12.5px] leading-5',
        style.box,
        className,
      )}
    >
      <Glyph className={clsx('mt-px h-4 w-4 shrink-0', style.icon)} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
