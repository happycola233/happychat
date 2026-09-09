import type { ReactNode } from 'react'
import { History, Images, Minus, Paperclip, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import type { ContextPolicy } from '@shared/types/context'
import {
  draftFromPolicy,
  policyFromDraft,
  type PolicyDraft,
  type RuleDraft,
} from './contextRuleDraft'
import { Select } from '../components/ui/Select'

const PRESETS: { label: string; description: string; policy: ContextPolicy }[] = [
  {
    label: '按轮优化',
    description: '完整文字 · 最近 3 轮附件',
    policy: {
      historyTurns: null,
      uploads: { mode: 'rounds', limit: 3 },
      generatedImages: { mode: 'rounds', limit: 3 },
    },
  },
  {
    label: '轻量携带',
    description: '最近 10 轮 · 最近 1 轮附件',
    policy: {
      historyTurns: 10,
      uploads: { mode: 'rounds', limit: 1 },
      generatedImages: { mode: 'rounds', limit: 1 },
    },
  },
  {
    label: '全部携带',
    description: '完整记录与所有附件',
    policy: { historyTurns: null, uploads: { mode: 'all' }, generatedImages: { mode: 'all' } },
  },
]

function CountInput({
  label,
  value,
  unit,
  onChange,
}: {
  label: string
  value: string
  unit: string
  onChange: (value: string) => void
}) {
  const invalid = !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1
  const step = (delta: number) =>
    onChange(String(Math.max(1, (invalid ? 0 : Number(value)) + delta)))
  const buttonClass =
    'flex h-full items-center justify-center text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
  return (
    <div
      className={clsx(
        'grid h-8 w-full grid-cols-[2rem_minmax(0,1fr)_2rem] overflow-hidden rounded-lg border bg-white text-xs dark:bg-neutral-900',
        invalid
          ? 'border-red-400 dark:border-red-500'
          : 'border-neutral-200 focus-within:border-sky-400 dark:border-neutral-700',
      )}
    >
      <button
        type="button"
        aria-label={`减少${label}`}
        disabled={!invalid && Number(value) <= 1}
        onClick={() => step(-1)}
        className={buttonClass}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <label className="flex min-w-0 items-center justify-center gap-2">
        <span className="text-neutral-400">最近</span>
        <input
          role="spinbutton"
          aria-label={label}
          aria-invalid={invalid}
          aria-valuemin={1}
          aria-valuenow={invalid ? undefined : Number(value)}
          inputMode="numeric"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              step(event.key === 'ArrowUp' ? 1 : -1)
            }
          }}
          style={{ width: `${Math.min(10, Math.max(2, value.length))}ch` }}
          className="min-w-0 bg-transparent text-center font-medium tabular-nums text-neutral-900 outline-none dark:text-neutral-100"
        />
        <span className="text-neutral-400">{unit}</span>
      </label>
      <button
        type="button"
        aria-label={`增加${label}`}
        disabled={!invalid && !Number.isSafeInteger(Number(value) + 1)}
        onClick={() => step(1)}
        className={buttonClass}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function RetentionRow({
  title,
  icon,
  description,
  value,
  unit,
  onChange,
}: {
  title: string
  icon: ReactNode
  description: string
  value: RuleDraft
  unit: string
  onChange: (value: RuleDraft) => void
}) {
  return (
    <div className="space-y-2 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-900 dark:text-neutral-100">
        {icon}
        {title}
      </div>
      <div className="grid gap-1.5">
        <Select
          aria-label={`${title}保留方式`}
          value={value.mode}
          size="sm"
          className="w-full"
          options={[
            { value: 'all', label: '全部携带' },
            { value: 'rounds', label: '按轮保留' },
            { value: 'items', label: '按个数保留' },
            { value: 'none', label: '不携带历史' },
          ]}
          onChange={(event) =>
            onChange({ ...value, mode: event.target.value as RuleDraft['mode'] })
          }
        />
        {(value.mode === 'rounds' || value.mode === 'items') && (
          <CountInput
            label={`${title}保留数量`}
            value={value.limit}
            unit={value.mode === 'rounds' ? '轮' : unit}
            onChange={(limit) => onChange({ ...value, limit })}
          />
        )}
      </div>
      <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
        {value.mode === 'all'
          ? '携带保留记录中的全部附件。'
          : value.mode === 'none'
            ? '不自动携带历史附件，仍可手动勾选。'
            : value.mode === 'items'
              ? '从最新的附件往前选，同一轮可能仅保留一部分。'
              : description}
      </p>
    </div>
  )
}

export function ContextRules({
  draft,
  onChange,
}: {
  draft: PolicyDraft
  onChange: (draft: PolicyDraft) => void
}) {
  const iconClass = 'h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500'
  const policy = policyFromDraft(draft)
  return (
    <>
      <div
        className="flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800"
        aria-label="上下文预设"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            title={preset.description}
            aria-pressed={JSON.stringify(policy) === JSON.stringify(preset.policy)}
            onClick={() => onChange(draftFromPolicy(preset.policy))}
            className={clsx(
              'flex-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
              JSON.stringify(policy) === JSON.stringify(preset.policy)
                ? 'bg-white text-sky-700 shadow-xs dark:bg-neutral-700 dark:text-sky-300'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="mt-1 divide-y divide-neutral-200/70 dark:divide-neutral-800">
        <div className="space-y-2 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-900 dark:text-neutral-100">
            <History className={iconClass} />
            聊天记录
          </div>
          <Select
            aria-label="聊天记录保留方式"
            value={draft.history.mode}
            size="sm"
            className="w-full"
            options={[
              { value: 'all', label: '全部记录' },
              { value: 'rounds', label: '最近几轮' },
              { value: 'none', label: '仅本次提问' },
            ]}
            onChange={(event) =>
              onChange({
                ...draft,
                history: {
                  ...draft.history,
                  mode: event.target.value as PolicyDraft['history']['mode'],
                },
              })
            }
          />
          {draft.history.mode === 'rounds' && (
            <CountInput
              label="聊天记录保留轮数"
              value={draft.history.limit}
              unit="轮"
              onChange={(limit) => onChange({ ...draft, history: { ...draft.history, limit } })}
            />
          )}
          <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
            一问一答算一轮，不含本次提问。
          </p>
        </div>
        <RetentionRow
          title="上传附件"
          icon={<Paperclip className={iconClass} />}
          value={draft.uploads}
          unit="个"
          description="按轮保留同次上传的整组附件，纯文字轮次不占数量。"
          onChange={(uploads) => onChange({ ...draft, uploads })}
        />
        <RetentionRow
          title="模型生成图"
          icon={<Images className={iconClass} />}
          value={draft.generatedImages}
          unit="张"
          description="按轮保留同次生成的整组图片。数量可自由填写。"
          onChange={(generatedImages) => onChange({ ...draft, generatedImages })}
        />
      </div>
    </>
  )
}
