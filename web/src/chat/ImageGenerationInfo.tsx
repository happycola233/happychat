import { useId, useRef, useState } from 'react'
import { Clock, Info, X } from 'lucide-react'
import type { ImageGenerationDetails } from '@shared/types/domain'
import { useAnchoredPopoverPosition } from '../hooks/useAnchoredPopoverPosition'
import { formatDuration } from '../lib/format'
import { imageGenerationDetailRows } from './imageGenerationDetails'

const ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'

/**
 * 生成图下方的用时与「详情」入口：详情来自随消息持久化的快照，刷新或分享后仍可查看。
 * 旧图片没有快照时，单图消息仍可用整次请求耗时显示用时。
 */
export function ImageGenerationInfo({
  details,
  revisedPrompt,
  fallbackDurationMs = null,
  showDuration = true,
}: {
  details?: ImageGenerationDetails
  revisedPrompt?: string
  fallbackDurationMs?: number | null
  /** 实时舞台标题已显示用时时关闭，避免同一张图出现两处用时。 */
  showDuration?: boolean
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const position = useAnchoredPopoverPosition(open, triggerRef, panelRef, 300)
  const durationMs = showDuration ? (details ? details.durationMs : fallbackDurationMs) : null
  if (!details && !durationMs) return null

  return (
    <>
      {durationMs !== null && durationMs > 0 && (
        <span
          className="inline-flex items-center gap-1 px-1 text-xs tabular-nums text-neutral-400 dark:text-neutral-500"
          title="生成用时"
        >
          <Clock aria-hidden className="h-3 w-3" />
          {formatDuration(durationMs)}
        </span>
      )}
      {details && (
        <>
          <button
            ref={triggerRef}
            type="button"
            popoverTarget={id}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={ACTION_CLASS}
          >
            <Info aria-hidden className="h-3.5 w-3.5" />
            详情
          </button>
          <div
            id={id}
            ref={panelRef}
            popover="auto"
            role="dialog"
            aria-labelledby={`${id}-title`}
            onToggle={(event) => setOpen(event.newState === 'open')}
            style={{ ...position, visibility: open && position ? 'visible' : 'hidden' }}
            className="fixed inset-auto m-0 w-[300px] max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-xl border-0 bg-white p-4 text-left text-xs leading-5 font-normal whitespace-normal text-neutral-600 shadow-lg ring-1 ring-black/10 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-white/10"
          >
            <div className="mb-3 flex items-center gap-2">
              <h3
                id={`${id}-title`}
                className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100"
              >
                生成详情
              </h3>
              <button
                type="button"
                popoverTarget={id}
                popoverTargetAction="hide"
                aria-label="关闭生成详情"
                className="-mr-1.5 -my-1.5 ml-auto inline-flex size-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 dark:hover:bg-neutral-800"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            <dl className="space-y-1.5">
              {imageGenerationDetailRows(details).map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-neutral-400 dark:text-neutral-500">{row.label}</dt>
                  <dd className="text-right font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            {revisedPrompt && (
              <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <div className="mb-1 text-neutral-400 dark:text-neutral-500">
                  模型改写后的提示词
                </div>
                <p className="text-neutral-700 dark:text-neutral-300">{revisedPrompt}</p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
