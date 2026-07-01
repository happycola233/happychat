import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  /** 传入后显示「每页条数」下拉；服务端上限 200。 */
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

/** 生成带省略号的页码序列：始终含首尾页 + 当前页附近窗口。 */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | 'gap')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) out.push('gap')
  for (let p = start; p <= end; p++) out.push(p)
  if (end < total - 1) out.push('gap')
  out.push(total)
  return out
}

const btnBase =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-sm tabular-nums transition disabled:cursor-not-allowed disabled:opacity-40'
const btnIdle =
  'border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
const btnActive =
  'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 200],
}: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const clampedPage = Math.min(page, pages)
  const window = pageWindow(clampedPage, pages)

  return (
    <div className="flex flex-col gap-3 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between dark:text-neutral-400">
      <div className="flex items-center gap-3">
        <span>
          共 {total.toLocaleString('zh-CN')} 条 · 第{' '}
          <span className="tabular-nums">{clampedPage}</span>/
          <span className="tabular-nums">{pages}</span> 页
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">每页</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-700 outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:focus:border-neutral-400"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n} 条
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={clsx(btnBase, btnIdle)}
          disabled={clampedPage <= 1}
          onClick={() => onPage(clampedPage - 1)}
          aria-label="上一页"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {window.map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-neutral-400 select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={clsx(btnBase, p === clampedPage ? btnActive : btnIdle)}
              aria-current={p === clampedPage ? 'page' : undefined}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className={clsx(btnBase, btnIdle)}
          disabled={clampedPage >= pages}
          onClick={() => onPage(clampedPage + 1)}
          aria-label="下一页"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
