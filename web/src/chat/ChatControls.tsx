import { useState } from 'react'
import { clsx } from 'clsx'
import { Brain, ChevronDown, Globe, ImageIcon } from 'lucide-react'
import type { ModelDTO } from '@shared/types/api'
import type { ReasoningEffort } from '@shared/types/domain'
import { useModels } from '../hooks/useModels'
import { useChatPrefs } from '../store/chat'

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

function WebToggle() {
  const { webSearch, setWebSearch } = useChatPrefs()
  return (
    <button
      type="button"
      onClick={() => setWebSearch(!webSearch)}
      className={clsx(
        'flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition',
        webSearch
          ? 'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
          : 'border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800',
      )}
      title="联网搜索"
    >
      <Globe className="h-3.5 w-3.5" /> 联网
    </button>
  )
}

function ReasoningSelect({ model }: { model: ModelDTO }) {
  const { reasoningEffort, setReasoningEffort } = useChatPrefs()
  const [open, setOpen] = useState(false)
  const effective = reasoningEffort ?? model.defaultEffort
  const label = effective ? EFFORT_LABELS[effective] : '默认'

  const options: { value: ReasoningEffort | null; label: string }[] = [
    { value: null, label: '默认' },
    ...model.allowedEfforts.map((e) => ({ value: e, label: EFFORT_LABELS[e] })),
  ]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition',
          reasoningEffort
            ? 'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
            : 'border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800',
        )}
        title="思考深度"
      >
        <Brain className="h-3.5 w-3.5" /> 思考·{label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-20 mb-1 w-32 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            {options.map((o) => (
              <button
                key={o.label}
                onClick={() => {
                  setReasoningEffort(o.value)
                  setOpen(false)
                }}
                className={clsx(
                  'block w-full rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  (reasoningEffort ?? null) === o.value && 'bg-neutral-100 dark:bg-neutral-800',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SelectChip({
  icon,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {icon} {current?.label ?? value}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-20 mb-1 w-32 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={clsx(
                  'block w-full rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  value === o.value && 'bg-neutral-100 dark:bg-neutral-800',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ImageControls() {
  const { imageSize, imageQuality, setImageSize, setImageQuality } = useChatPrefs()
  return (
    <>
      <SelectChip
        icon={<ImageIcon className="h-3.5 w-3.5" />}
        value={imageSize}
        onChange={setImageSize}
        options={[
          { value: 'auto', label: '自动尺寸' },
          { value: '1024x1024', label: '1024×1024' },
          { value: '1536x1024', label: '1536×1024 横' },
          { value: '1024x1536', label: '1024×1536 竖' },
        ]}
      />
      <SelectChip
        icon={null}
        value={imageQuality}
        onChange={setImageQuality}
        options={[
          { value: 'auto', label: '画质·自动' },
          { value: 'low', label: '画质·低' },
          { value: 'medium', label: '画质·中' },
          { value: 'high', label: '画质·高' },
        ]}
      />
    </>
  )
}

export function ChatControls() {
  const { data: models } = useModels()
  const { selectedModelId } = useChatPrefs()
  const model = models?.find((m) => m.id === selectedModelId)
  if (!model) return null
  if (model.kind === 'image') return <ImageControls />
  return (
    <>
      {model.capabilities.web_search && <WebToggle />}
      {model.capabilities.reasoning && <ReasoningSelect model={model} />}
    </>
  )
}
