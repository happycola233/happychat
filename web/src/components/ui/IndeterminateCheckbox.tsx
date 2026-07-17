import { useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'

interface Props {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  /** 复选框没有包裹在 label 内时，用它提供无障碍名称。 */
  ariaLabel?: string
}

/**
 * 自绘三态复选框：原生 input 保留键盘/读屏行为，视觉层用图标覆盖，
 * mixed 状态通过 DOM property 设置（HTML 没有对应 attribute）。
 */
export function IndeterminateCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: Props) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <span className="relative flex h-[18px] w-[18px] shrink-0">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        className="peer h-full w-full cursor-pointer appearance-none rounded-[5px] border border-neutral-300 bg-white transition-colors checked:border-sky-500 checked:bg-sky-500 indeterminate:border-sky-500 indeterminate:bg-sky-500 hover:border-neutral-400 checked:hover:border-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-1 dark:border-neutral-600 dark:bg-neutral-800 dark:checked:border-sky-500 dark:checked:bg-sky-500 dark:indeterminate:border-sky-500 dark:indeterminate:bg-sky-500 dark:hover:border-neutral-500 dark:focus-visible:ring-offset-neutral-900"
      />
      <Check
        strokeWidth={3.5}
        className="pointer-events-none absolute inset-0 m-auto hidden h-3 w-3 text-white peer-checked:block peer-indeterminate:hidden"
      />
      <Minus
        strokeWidth={3.5}
        className="pointer-events-none absolute inset-0 m-auto hidden h-3 w-3 text-white peer-indeterminate:block"
      />
    </span>
  )
}
