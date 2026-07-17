import { clsx } from 'clsx'

interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** 开关没有相邻可关联标签时，用它提供无障碍名称。 */
  ariaLabel?: string
}

export function Toggle({ checked, onChange, disabled, ariaLabel }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-6 w-11 shrink-0 rounded-full transition',
        checked ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-700',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all',
          checked ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
  )
}
