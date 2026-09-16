import { ImageIcon } from 'lucide-react'
import type { UsageLogDTO } from '@shared/types/api'

export function RequestGeneratedImagesBadge({
  row,
}: {
  row: Pick<UsageLogDTO, 'generatedImageCount'>
}) {
  if (row.generatedImageCount === 0) return null

  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] leading-5 font-medium whitespace-nowrap text-sky-600 dark:text-sky-400">
      <ImageIcon aria-hidden className="h-3 w-3" />
      生成图片 · {row.generatedImageCount}
    </span>
  )
}
