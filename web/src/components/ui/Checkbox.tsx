import { useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  /** 复选框没有可见 label 时，用它提供无障碍名称。 */
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

/**
 * 全站统一的二态 / 三态复选框。真实 input 保留键盘、表单和读屏行为，视觉层统一覆盖
 * 浏览器与操作系统的原生外观；mixed 状态通过 DOM property 设置（HTML 没有对应 attribute）。
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: Props) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <span
      className={clsx(
        'relative flex h-[18px] w-[18px] shrink-0',
        disabled && 'opacity-50',
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel}
        className="peer h-full w-full cursor-pointer appearance-none rounded-[5px] border border-neutral-300 bg-white transition-colors checked:border-sky-500 checked:bg-sky-500 indeterminate:border-sky-500 indeterminate:bg-sky-500 enabled:hover:border-neutral-400 checked:enabled:hover:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed dark:border-neutral-600 dark:bg-neutral-800 dark:checked:border-sky-500 dark:checked:bg-sky-500 dark:indeterminate:border-sky-500 dark:indeterminate:bg-sky-500 dark:enabled:hover:border-neutral-500 dark:focus-visible:ring-offset-neutral-900 forced-colors:appearance-auto"
      />
      <Check
        strokeWidth={3.5}
        className="pointer-events-none absolute inset-0 m-auto hidden h-3 w-3 text-white peer-checked:block peer-indeterminate:hidden forced-colors:invisible"
      />
      <Minus
        strokeWidth={3.5}
        className="pointer-events-none absolute inset-0 m-auto hidden h-3 w-3 text-white peer-indeterminate:block forced-colors:invisible"
      />
    </span>
  )
}
