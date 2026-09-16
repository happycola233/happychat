import { Search, X } from 'lucide-react'
import { clsx } from 'clsx'
import { inputClass } from './controlStyles'

export function SearchField({
  value,
  onChange,
  placeholder = '搜索',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={clsx('relative min-w-0', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
      />
      <input
        type="search"
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={clsx(inputClass, 'pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none')}
      />
      {value && (
        <button
          type="button"
          aria-label="清除搜索"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
