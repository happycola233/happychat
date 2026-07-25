import { clsx } from 'clsx'
import {
  PASSWORD_STRENGTH_LEVELS,
  scorePasswordStrength,
  type PasswordStrengthScore,
} from './passwordStrength'

const LEVEL_STYLES: Record<
  Exclude<PasswordStrengthScore, 0>,
  { label: string; bar: string; text: string }
> = {
  1: { label: '弱', bar: 'bg-rose-400', text: 'text-rose-500 dark:text-rose-400' },
  2: { label: '一般', bar: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400' },
  3: { label: '较强', bar: 'bg-sky-400', text: 'text-sky-600 dark:text-sky-400' },
  4: { label: '很强', bar: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' },
}

/**
 * 密码强度指示：四段细条 + 一个词，放在「密码」标签行右侧而不是输入框下方——
 * 下方那行留给校验错误，两者错开就不会在输入过程中把表单顶来顶去。
 * 纯装饰性反馈，对读屏隐藏（真正的约束由字段错误文案播报）。
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const score = scorePasswordStrength(password)
  if (score === 0) return null
  const style = LEVEL_STYLES[score]

  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      <span className="flex items-center gap-[3px]">
        {Array.from({ length: PASSWORD_STRENGTH_LEVELS }, (_, index) => (
          <span
            key={index}
            className={clsx(
              'h-[3px] w-3.5 rounded-full transition-colors',
              index < score ? style.bar : 'bg-neutral-200 dark:bg-neutral-700',
            )}
          />
        ))}
      </span>
      <span className={clsx('text-[11px] font-medium', style.text)}>{style.label}</span>
    </span>
  )
}
