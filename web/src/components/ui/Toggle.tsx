import { clsx } from 'clsx'

interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

export function Toggle({ checked, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-6 w-11 shrink-0 rounded-full transition',
        checked ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-300 dark:bg-neutral-700',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all dark:bg-neutral-900',
          checked ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
  )
}
