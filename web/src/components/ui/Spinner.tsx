import { clsx } from 'clsx'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        className ?? 'h-5 w-5',
      )}
      aria-hidden
    />
  )
}

export function FullScreenLoader() {
  return (
    <div className="flex min-h-full items-center justify-center text-neutral-400">
      <Spinner className="h-6 w-6" />
    </div>
  )
}
