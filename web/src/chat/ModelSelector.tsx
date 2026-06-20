import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown } from 'lucide-react'
import { useModels } from '../hooks/useModels'
import { useChatPrefs } from '../store/chat'

export function ModelSelector() {
  const { data: models } = useModels()
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const setActiveModel = useChatPrefs((s) => s.setActiveModel)
  const [open, setOpen] = useState(false)

  // 当前无有效选择（首次使用或所选已失效）时，回退首个可用模型
  useEffect(() => {
    if (!models?.length) return
    if (!activeModelId || !models.some((m) => m.id === activeModelId)) {
      setActiveModel(models[0]!.id)
    }
  }, [models, activeModelId, setActiveModel])

  if (!models?.length) {
    return <span className="text-sm text-neutral-400">暂无可用模型</span>
  }
  const current = models.find((m) => m.id === activeModelId)

  return (
    <div className={clsx('relative', open && 'z-40')}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >
        {current?.displayName ?? '选择模型'}
        <ChevronDown className="h-4 w-4 text-neutral-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 w-60 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setActiveModel(m.id)
                  setOpen(false)
                }}
                className={clsx(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  m.id === activeModelId && 'bg-neutral-100 dark:bg-neutral-800',
                )}
              >
                <span className="text-neutral-800 dark:text-neutral-100">{m.displayName}</span>
                {m.kind === 'image' && <span className="text-xs text-neutral-400">生图</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
