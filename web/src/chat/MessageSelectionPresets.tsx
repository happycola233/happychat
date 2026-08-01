import { clsx } from 'clsx'
import {
  messageIdsForPreset,
  type MessageSelectionPreset,
  type SelectableMessage,
} from './messageSelection'

const PRESET_LABELS: Record<MessageSelectionPreset, string> = {
  all: '全部消息',
  user: '全部用户消息',
  assistant: '全部 AI 回复',
}

const PRESETS: readonly MessageSelectionPreset[] = ['all', 'user', 'assistant']

function selectionMatchesPreset(selectedIds: ReadonlySet<string>, presetIds: readonly string[]) {
  return (
    presetIds.length > 0 &&
    selectedIds.size === presetIds.length &&
    presetIds.every((id) => selectedIds.has(id))
  )
}

function QuickSelectChip({
  label,
  active,
  onClick,
  testId,
}: {
  label: string
  active: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={clsx(
        'rounded-full border px-2.5 py-1 text-xs transition select-none',
        active
          ? 'border-sky-300 bg-sky-500/10 font-medium text-sky-600 dark:border-sky-500/40 dark:text-sky-400'
          : 'border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
      )}
    >
      {label}
    </button>
  )
}

/** 分享与导出共用的消息快捷选择栏。 */
export function MessageSelectionPresets({
  messages,
  selectedIds,
  onChange,
  testIdPrefix,
}: {
  messages: readonly SelectableMessage[]
  selectedIds: ReadonlySet<string>
  onChange: (ids: ReadonlySet<string>) => void
  testIdPrefix: 'share' | 'export'
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="快捷选择消息">
      {PRESETS.map((preset) => {
        const ids = messageIdsForPreset(messages, preset)
        return (
          <QuickSelectChip
            key={preset}
            label={PRESET_LABELS[preset]}
            active={selectionMatchesPreset(selectedIds, ids)}
            onClick={() => onChange(new Set(ids))}
            testId={`${testIdPrefix}-quick-${preset === 'assistant' ? 'ai' : preset}`}
          />
        )
      })}
      {selectedIds.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          data-testid={`${testIdPrefix}-quick-clear`}
          className="rounded-full px-2 py-1 text-xs text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          清空
        </button>
      )}
    </div>
  )
}
