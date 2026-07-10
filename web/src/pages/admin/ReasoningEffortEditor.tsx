import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  createReasoningEffortDraft,
  getReasoningEffortDraftErrors,
  type ReasoningEffortDraft,
  validateReasoningEffortDrafts,
} from './reasoningEffortDrafts'

const inputClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-400'

interface Props {
  drafts: ReasoningEffortDraft[]
  defaultDraftId: string | null
  onDraftsChange: (drafts: ReasoningEffortDraft[]) => void
  onDefaultDraftIdChange: (draftId: string | null) => void
}

/** 自定义推理等级列表：顺序会原样用于聊天端展示。 */
export function ReasoningEffortEditor({
  drafts,
  defaultDraftId,
  onDraftsChange,
  onDefaultDraftIdChange,
}: Props) {
  const fieldErrors = getReasoningEffortDraftErrors(drafts)
  const validationError = validateReasoningEffortDrafts(drafts)
  const updateDraft = (
    draftId: string,
    field: 'value' | 'description',
    value: string,
  ) => {
    onDraftsChange(
      drafts.map((draft) => (draft.draftId === draftId ? { ...draft, [field]: value } : draft)),
    )
  }

  const removeDraft = (draftId: string) => {
    onDraftsChange(drafts.filter((draft) => draft.draftId !== draftId))
    if (defaultDraftId === draftId) onDefaultDraftIdChange(null)
  }

  const moveDraft = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset
    if (targetIndex < 0 || targetIndex >= drafts.length) return
    const next = [...drafts]
    ;[next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!]
    onDraftsChange(next)
  }

  const addDraft = () => {
    if (drafts.length >= 16) return
    onDraftsChange([...drafts, createReasoningEffortDraft()])
  }

  return (
    <div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
      <div className="text-xs font-medium text-neutral-700 dark:text-neutral-200">思考等级</div>
      <p className="mt-0.5 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
        上游值会原样写入 reasoning.effort；显示描述仅用于界面。列表顺序也会用于聊天选择器。
      </p>

      <div className="mt-3 space-y-2">
        {drafts.map((draft, index) => {
          const draftErrors = fieldErrors[draft.draftId]
          const valueError = draftErrors?.value
          const descriptionError = draftErrors?.description
          const valueErrorId = `${draft.draftId}-value-error`
          const descriptionErrorId = `${draft.draftId}-description-error`

          return (
            <div
              key={draft.draftId}
              className="grid grid-cols-1 gap-2 rounded-xl border border-neutral-200 bg-white p-2.5 dark:border-neutral-700 dark:bg-neutral-900/50 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto] sm:items-start"
            >
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] text-neutral-400">上游值</span>
                <input
                  className={`${inputClass} ${
                    valueError
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/10 dark:border-red-500 dark:focus:border-red-400'
                      : ''
                  }`}
                  value={draft.value}
                  onChange={(event) => updateDraft(draft.draftId, 'value', event.target.value)}
                  placeholder="如 xhigh"
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={valueError ? true : undefined}
                  aria-describedby={valueError ? valueErrorId : undefined}
                />
                {valueError && (
                  <span
                    id={valueErrorId}
                    className="mt-1 block text-[11px] leading-4 text-red-600 dark:text-red-400"
                  >
                    {valueError}
                  </span>
                )}
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] text-neutral-400">显示描述</span>
                <input
                  className={`${inputClass} ${
                    descriptionError
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/10 dark:border-red-500 dark:focus:border-red-400'
                      : ''
                  }`}
                  value={draft.description}
                  onChange={(event) =>
                    updateDraft(draft.draftId, 'description', event.target.value)
                  }
                  placeholder="如 超高"
                  aria-invalid={descriptionError ? true : undefined}
                  aria-describedby={descriptionError ? descriptionErrorId : undefined}
                />
                {descriptionError && (
                  <span
                    id={descriptionErrorId}
                    className="mt-1 block text-[11px] leading-4 text-red-600 dark:text-red-400"
                  >
                    {descriptionError}
                  </span>
                )}
              </label>
              <div className="flex items-center justify-end gap-1 sm:pt-[1.375rem]">
                <button
                  type="button"
                  onClick={() => moveDraft(index, -1)}
                  disabled={index === 0}
                  aria-label={`上移 ${draft.description || draft.value || '未命名等级'}`}
                  title="上移"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-25 disabled:hover:bg-transparent dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => moveDraft(index, 1)}
                  disabled={index === drafts.length - 1}
                  aria-label={`下移 ${draft.description || draft.value || '未命名等级'}`}
                  title="下移"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-25 disabled:hover:bg-transparent dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => removeDraft(draft.draftId)}
                  aria-label={`删除 ${draft.description || draft.value || '未命名等级'}`}
                  title="删除"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          )
        })}

        {drafts.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-400 dark:border-neutral-700">
            尚未配置推理等级
          </div>
        )}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={addDraft}
          disabled={drafts.length >= 16}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2.5 text-xs text-neutral-600 transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          添加等级
        </button>
      </div>

      {validationError && (
        <p role="alert" className="mt-2 text-xs leading-5 text-red-600 dark:text-red-400">
          {validationError}
        </p>
      )}

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs text-neutral-500">默认思考等级</span>
        <select
          className={inputClass}
          value={defaultDraftId ?? ''}
          onChange={(event) => onDefaultDraftIdChange(event.target.value || null)}
          disabled={drafts.length === 0}
        >
          <option value="">未设置</option>
          {drafts.map((draft) => (
            <option key={draft.draftId} value={draft.draftId} disabled={!draft.value.trim()}>
              {draft.description.trim() || '未命名'}
              {draft.value.trim() ? `（${draft.value.trim()}）` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
