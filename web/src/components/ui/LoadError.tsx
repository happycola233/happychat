import { Button } from './Button'

export function LoadError({
  onRetry,
  hasData = false,
}: {
  onRetry: () => void
  hasData?: boolean
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <span>{hasData ? '刷新未成功，当前显示上次获取的数据。' : '暂时无法加载数据，请重试。'}</span>
      <Button variant="ghost" onClick={onRetry}>
        重新加载
      </Button>
    </div>
  )
}
