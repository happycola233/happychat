import { useEffect } from 'react'
import { Button } from './Button'
import { useConfirmStore } from '../../store/confirm'

/**
 * 全局确认对话框宿主：在 App 顶层渲染一次，配合 `askConfirm()` 使用。
 * 居中小卡片；Escape / 点遮罩视为取消，打开时聚焦取消按钮（危险操作默认安全项）。
 */
export function ConfirmDialogHost() {
  const current = useConfirmStore((s) => s.current)
  const settle = useConfirmStore((s) => s.settle)

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, settle])

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={current.title}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => settle(false)} />
      <div className="hc-pop-in relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
        <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
          {current.title}
        </h3>
        {current.description && (
          <p className="mt-1.5 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            {current.description}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            autoFocus
            variant="secondary"
            className="!px-3.5 !py-2 text-[13px]"
            onClick={() => settle(false)}
          >
            {current.cancelLabel ?? '取消'}
          </Button>
          <Button
            variant={current.tone === 'danger' ? 'danger' : 'primary'}
            className="!px-3.5 !py-2 text-[13px]"
            onClick={() => settle(true)}
          >
            {current.confirmLabel ?? '确认'}
          </Button>
        </div>
      </div>
    </div>
  )
}
