import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { HeaderDraft } from './providerHeaderDrafts'
import { Button } from '../../components/ui/Button'
import { inputClass } from '../../components/ui/controlStyles'
import { createRandomUuid } from '../../lib/randomUuid'

export function ProviderHeadersEditor({
  drafts,
  onChange,
  disabled,
}: {
  drafts: HeaderDraft[]
  onChange: (drafts: HeaderDraft[]) => void
  disabled: boolean
}) {
  const [visible, setVisible] = useState(false)
  const update = (id: string, field: 'name' | 'value', value: string) =>
    onChange(drafts.map((draft) => (draft.id === id ? { ...draft, [field]: value } : draft)))
  return (
    <section className="space-y-3 pt-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            额外请求头{' '}
            <span className="ml-1 text-xs font-normal text-neutral-400">
              {drafts.length || '可选'}
            </span>
          </h3>
          <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            用于网关鉴权、项目标识或实验功能。所有上游请求都会携带。
          </p>
        </div>
        {drafts.length > 0 && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label={visible ? '隐藏请求头值' : '显示请求头值'}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {drafts.map((draft, index) => (
        <div key={draft.id} className="flex items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <input
              className={`${inputClass} font-mono text-xs`}
              aria-label={`请求头 ${index + 1} 名称`}
              placeholder="例如 OpenAI-Project"
              value={draft.name}
              onChange={(event) => update(draft.id, 'name', event.target.value)}
              disabled={disabled}
              spellCheck={false}
            />
            <input
              className={`${inputClass} font-mono text-xs`}
              aria-label={`请求头 ${index + 1} 值`}
              placeholder="请求头的值"
              type={visible ? 'text' : 'password'}
              value={draft.value}
              onChange={(event) => update(draft.id, 'value', event.target.value)}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            className="rounded-lg p-2.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
            aria-label={`移除请求头 ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(drafts.filter((item) => item.id !== draft.id))}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        className="!px-2 !py-1.5 text-xs"
        disabled={disabled || drafts.length >= 32}
        onClick={() => onChange([...drafts, { id: createRandomUuid(), name: '', value: '' }])}
      >
        <Plus className="h-3.5 w-3.5" />
        添加请求头
      </Button>
      {drafts.length > 0 && (
        <p className="text-xs leading-5 text-neutral-400 dark:text-neutral-500">
          同名请求头会覆盖默认鉴权或版本值。Content-Type 等传输字段由系统设置。
        </p>
      )}
    </section>
  )
}
