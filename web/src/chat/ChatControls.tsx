import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Brain, Check, ChevronDown, Globe, ImageIcon, Pin } from 'lucide-react'
import type { ModelDTO } from '@shared/types/api'
import { effectiveWebSearchEnabled } from '@shared/util/webSearch'
import {
  GPT_IMAGE_2_SIZE_OPTIONS,
  formatImageSizeLabel,
  parseImageSize,
  validateGptImage2Size,
} from '@shared/util/imageSize'
import { useModels } from '../hooks/useModels'
import {
  REASONING_EFFORT_OPTION_LABELS,
  REASONING_EFFORT_SHORT_LABELS,
} from '../lib/reasoningLabels'
import { useChatPrefs } from '../store/chat'

function ImageSizeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const parsed = parseImageSize(value)
    if (parsed) {
      setWidth(String(parsed.width))
      setHeight(String(parsed.height))
    }
    setError(null)
  }, [open, value])

  const applyCustom = () => {
    const normalizedWidth = width.trim()
    const normalizedHeight = height.trim()
    if (!/^\d+$/.test(normalizedWidth) || !/^\d+$/.test(normalizedHeight)) {
      setError('宽高必须是整数')
      return
    }
    const result = validateGptImage2Size(`${normalizedWidth}x${normalizedHeight}`)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onChange(result.normalizedSize)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-full border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        title="分辨率"
      >
        <ImageIcon className="h-3.5 w-3.5" /> {formatImageSizeLabel(value)}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-20 mb-1 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 bg-white p-1 text-neutral-700 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
            <div className="hc-scrollbar max-h-64 overflow-y-auto">
              {GPT_IMAGE_2_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  onClick={() => {
                    onChange(size)
                    setOpen(false)
                  }}
                  className={clsx(
                    'block w-full rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                    value === size && 'bg-neutral-100 dark:bg-neutral-800',
                  )}
                >
                  {formatImageSizeLabel(size)}
                </button>
              ))}
            </div>
            <div className="mt-1 border-t border-neutral-100 px-2 py-2 dark:border-neutral-800">
              <div className="mb-1 text-xs text-neutral-400">自定义</div>
              <div className="flex items-center gap-1.5">
                <input
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  inputMode="numeric"
                  className="h-8 w-20 shrink-0 rounded-lg border border-neutral-200 bg-white px-2 text-center text-sm tabular-nums text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  aria-label="图片宽度"
                />
                <span className="text-xs text-neutral-400">×</span>
                <input
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  inputMode="numeric"
                  className="h-8 w-20 shrink-0 rounded-lg border border-neutral-200 bg-white px-2 text-center text-sm tabular-nums text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  aria-label="图片高度"
                />
                <button
                  type="button"
                  onClick={applyCustom}
                  className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
                  aria-label="应用自定义分辨率"
                  title="应用"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
              {error && <div className="mt-1 text-xs text-red-500">{error}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function WebToggle({ model }: { model: ModelDTO }) {
  const activeWebSearch = useChatPrefs((s) => s.activeWebSearch)
  const setActiveWebSearch = useChatPrefs((s) => s.setActiveWebSearch)
  const enabled = activeWebSearch ?? effectiveWebSearchEnabled(model)
  return (
    <button
      type="button"
      onClick={() => setActiveWebSearch(!enabled)}
      className={clsx(
        'flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs transition',
        enabled
          ? 'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
          : 'border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800',
      )}
      title={activeWebSearch === null ? '联网搜索（使用模型默认）' : '联网搜索（本次会话临时开关）'}
    >
      <Globe className="h-3.5 w-3.5" /> 联网
    </button>
  )
}

function ReasoningSelect({ model }: { model: ModelDTO }) {
  const activeEffort = useChatPrefs((s) => s.activeEffort)
  const setActiveEffort = useChatPrefs((s) => s.setActiveEffort)
  const pinnedEffort = useChatPrefs((s) => s.pinnedEffort)
  const pinEffort = useChatPrefs((s) => s.pinEffort)
  const [open, setOpen] = useState(false)
  const effective = activeEffort ?? model.defaultEffort
  const label = effective ? REASONING_EFFORT_SHORT_LABELS[effective] : '默认'

  const options = model.allowedEfforts.map((e) => ({
    value: e,
    label: REASONING_EFFORT_OPTION_LABELS[e],
  }))

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition',
          activeEffort
            ? 'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
            : 'border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800',
        )}
        title={activeEffort ? `本次思考深度：${label}` : `思考深度：${label}（默认）`}
      >
        <Brain className="h-3.5 w-3.5" /> 思考 · {label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-20 mb-1 w-52 rounded-xl border border-neutral-200 bg-white p-1 text-neutral-700 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
            {options.map((o) => {
              const isActive = activeEffort === o.value
              const isPinned = pinnedEffort === o.value
              return (
                <div
                  key={o.value}
                  className={clsx(
                    'flex items-center rounded-lg pr-1 transition hover:bg-neutral-100 dark:hover:bg-neutral-800',
                    isActive && 'bg-violet-50 dark:bg-violet-950/40',
                  )}
                >
                  <button
                    onClick={() => {
                      setActiveEffort(isActive ? null : o.value)
                      setOpen(false)
                    }}
                    title="临时使用这个思考深度"
                    className="flex-1 px-3 py-1.5 text-left text-sm"
                  >
                    <span
                      className={clsx(isActive && 'text-violet-600 dark:text-violet-300')}
                    >
                      {o.label}
                    </span>
                  </button>
                  <button
                    onClick={() => pinEffort(o.value)}
                    title={isPinned ? '取消固定默认' : '设为默认（固定）'}
                    className="rounded-md p-1.5 transition hover:bg-neutral-200/70 dark:hover:bg-neutral-700"
                  >
                    <Pin
                      className={clsx(
                        'h-3.5 w-3.5 shrink-0',
                        isPinned
                          ? 'fill-current text-violet-500'
                          : 'text-neutral-300 dark:text-neutral-600',
                      )}
                    />
                  </button>
                </div>
              )
            })}
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
  options: { value: string; label: string; buttonLabel?: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-full border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {icon} {current?.buttonLabel ?? current?.label ?? value}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-20 mb-1 w-32 rounded-xl border border-neutral-200 bg-white p-1 text-neutral-700 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
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
      <ImageSizeSelect value={imageSize} onChange={setImageSize} />
      <SelectChip
        icon={null}
        value={imageQuality}
        onChange={setImageQuality}
        options={[
          { value: 'auto', label: '自动', buttonLabel: '画质 · 自动' },
          { value: 'low', label: '低', buttonLabel: '画质 · 低' },
          { value: 'medium', label: '中', buttonLabel: '画质 · 中' },
          { value: 'high', label: '高', buttonLabel: '画质 · 高' },
        ]}
      />
    </>
  )
}

export function ChatControls() {
  const { data: models } = useModels()
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const model = models?.find((m) => m.id === activeModelId)
  if (!model) return null
  if (model.kind === 'image') return <ImageControls />
  return (
    <>
      {model.capabilities.web_search && <WebToggle model={model} />}
      {model.capabilities.reasoning && <ReasoningSelect model={model} />}
    </>
  )
}
