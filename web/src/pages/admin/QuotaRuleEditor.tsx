import { clsx } from 'clsx'
import { Trash2 } from 'lucide-react'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import { describeQuotaRule } from '@shared/util/quota'
import { QUOTA_ROLLING_PRESET_HOURS } from '@shared/util/quota'
import { describeRollingHours } from '@shared/util/quotaWindow'
import { Checkbox } from '../../components/ui/Checkbox'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import {
  ruleFromDraft,
  type QuotaRuleDraft,
  type QuotaScopeType,
  type QuotaWindowChoice,
} from './quotaRuleDrafts'

const FIELD_LABEL_CLASS =
  'mb-1 block text-[11px] font-medium text-neutral-500 dark:text-neutral-400'
const SEGMENT_CLASS =
  'flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800'

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition',
        active
          ? 'bg-white text-neutral-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
      )}
    >
      {children}
    </button>
  )
}

/** 目标多选：模型/分组共用同一个带勾选的紧凑滚动列表。 */
function TargetPicker({
  items,
  selected,
  onToggle,
  emptyHint,
}: {
  items: { id: string; label: string; hint?: string }[]
  selected: string[]
  onToggle: (id: string, checked: boolean) => void
  emptyHint: string
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-400 dark:border-neutral-700">
        {emptyHint}
      </div>
    )
  }
  return (
    <div className="hc-scrollbar max-h-40 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
      {items.map((item) => (
        <label
          key={item.id}
          className="flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-sm transition hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
        >
          <Checkbox
            checked={selected.includes(item.id)}
            onChange={(checked) => onToggle(item.id, checked)}
            ariaLabel={item.label}
          />
          <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
            {item.label}
          </span>
          {item.hint && (
            <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
              {item.hint}
            </span>
          )}
        </label>
      ))}
    </div>
  )
}

/**
 * 单条限额规则的编辑器。
 *
 * 四个维度横向铺开：适用范围 × 计量口径 × 上限 × 周期；底部实时给出中文摘要，
 * 让管理员在保存前就读懂这条规则的含义（与用户端进度条同一份文案函数）。
 */
export function QuotaRuleEditor({
  draft,
  models,
  groups,
  onChange,
  onRemove,
  invalidMessage,
}: {
  draft: QuotaRuleDraft
  models: AdminModelDTO[]
  groups: AdminModelGroupDTO[]
  onChange: (next: QuotaRuleDraft) => void
  onRemove: () => void
  /** 保存时由外层填入的错误提示 */
  invalidMessage?: string
}) {
  const patch = (changes: Partial<QuotaRuleDraft>) => onChange({ ...draft, ...changes })
  const preview = ruleFromDraft(draft)
  const modelNames = Object.fromEntries(models.map((model) => [model.id, model.displayName]))
  const groupNames = Object.fromEntries(groups.map((group) => [group.id, group.name]))

  return (
    <div className="rounded-xl border border-neutral-200 p-3.5 dark:border-neutral-700">
      <div className="mb-3 flex items-center gap-2">
        <input
          value={draft.label}
          onChange={(event) => patch({ label: event.target.value })}
          placeholder="规则备注（可选，如「日常上限」）"
          maxLength={40}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-neutral-100 px-2.5 py-1.5 text-sm text-neutral-800 outline-none transition placeholder:text-neutral-400 focus:border-neutral-300 focus:bg-white dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-600 dark:focus:bg-neutral-900"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="删除这条规则"
          className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className={FIELD_LABEL_CLASS}>适用范围</span>
          <Select
            value={draft.scopeType}
            onChange={(event) =>
              patch({ scopeType: event.target.value as QuotaScopeType, targetIds: [] })
            }
            options={[
              { value: 'all', label: '全部模型' },
              { value: 'models', label: '指定模型' },
              { value: 'groups', label: '模型分组' },
            ]}
          />
        </div>
        <div>
          <span className={FIELD_LABEL_CLASS}>计量口径</span>
          <div className={SEGMENT_CLASS}>
            <SegmentButton
              active={draft.metric === 'cost'}
              onClick={() => patch({ metric: 'cost' })}
            >
              消费金额（$）
            </SegmentButton>
            <SegmentButton
              active={draft.metric === 'requests'}
              onClick={() => patch({ metric: 'requests' })}
            >
              请求次数
            </SegmentButton>
          </div>
        </div>

        {draft.scopeType !== 'all' && (
          <div className="sm:col-span-2">
            <div className="mb-1 flex items-end justify-between gap-3">
              <span className={clsx(FIELD_LABEL_CLASS, 'mb-0')}>
                {draft.scopeType === 'models' ? '选择模型' : '选择分组'}
                <span className="ml-1 font-normal text-neutral-400">
                  已选 {draft.targetIds.length}
                </span>
              </span>
              <div className={clsx(SEGMENT_CLASS, 'shrink-0')}>
                <SegmentButton
                  active={draft.mode === 'each'}
                  onClick={() => patch({ mode: 'each' })}
                >
                  各自独立额度
                </SegmentButton>
                <SegmentButton
                  active={draft.mode === 'shared'}
                  onClick={() => patch({ mode: 'shared' })}
                >
                  共享一个额度
                </SegmentButton>
              </div>
            </div>
            <TargetPicker
              items={
                draft.scopeType === 'models'
                  ? models.map((model) => ({
                      id: model.id,
                      label: model.displayName,
                      hint: model.providerName,
                    }))
                  : groups.map((group) => ({
                      id: group.id,
                      label: group.name,
                      hint: `${group.modelCount} 个模型`,
                    }))
              }
              selected={draft.targetIds}
              onToggle={(id, checked) =>
                patch({
                  targetIds: checked
                    ? [...draft.targetIds, id]
                    : draft.targetIds.filter((item) => item !== id),
                })
              }
              emptyHint={draft.scopeType === 'models' ? '还没有配置模型' : '还没有创建模型分组'}
            />
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={clsx(FIELD_LABEL_CLASS, 'mb-0')}>额度上限</span>
            <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              不限
              <Toggle
                checked={draft.unlimited}
                onChange={(checked) => patch({ unlimited: checked })}
                ariaLabel="不限额度"
              />
            </label>
          </div>
          {draft.unlimited ? (
            <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-2 text-sm text-neutral-400 dark:border-neutral-700">
              无限额度
            </div>
          ) : (
            <div className="relative">
              {draft.metric === 'cost' && (
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                  $
                </span>
              )}
              <input
                value={draft.limitInput}
                onChange={(event) => patch({ limitInput: event.target.value })}
                inputMode="decimal"
                placeholder={draft.metric === 'cost' ? '10' : '300'}
                className={clsx(
                  'w-full rounded-lg border border-neutral-300 bg-white py-2 pr-10 text-sm tabular-nums text-neutral-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-sky-400',
                  draft.metric === 'cost' ? 'pl-7' : 'pl-3',
                )}
              />
              {draft.metric === 'requests' && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                  次
                </span>
              )}
            </div>
          )}
        </div>

        <div>
          <span className={FIELD_LABEL_CLASS}>统计周期</span>
          <Select
            value={draft.windowChoice}
            onChange={(event) => patch({ windowChoice: event.target.value as QuotaWindowChoice })}
            options={[
              { value: 'day', label: '每天（自然日）' },
              { value: 'week', label: '每周（自然周）' },
              { value: 'month', label: '每月（自然月）' },
              { value: 'rolling', label: '滚动窗口' },
              { value: 'total', label: '永久累计（不重置）' },
            ]}
          />
          {draft.windowChoice === 'rolling' && (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={draft.rollingHoursInput}
                onChange={(event) => patch({ rollingHoursInput: event.target.value })}
                inputMode="numeric"
                aria-label="滚动窗口小时数"
                className="w-20 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm tabular-nums text-neutral-800 outline-none transition focus:border-sky-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-sky-400"
              />
              <span className="text-xs text-neutral-400">小时</span>
              <div className="ml-auto flex gap-1">
                {QUOTA_ROLLING_PRESET_HOURS.map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => patch({ rollingHoursInput: String(hours) })}
                    className={clsx(
                      'rounded-md px-1.5 py-0.5 text-[11px] transition',
                      Number(draft.rollingHoursInput) === hours
                        ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300'
                        : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
                    )}
                  >
                    {describeRollingHours(hours)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 实时摘要 / 校验：与用户端进度条共用 describeQuotaRule，所见即所得。 */}
      <div
        className={clsx(
          'mt-3 rounded-lg px-2.5 py-1.5 text-[11px] leading-5',
          preview.ok && !invalidMessage
            ? 'bg-neutral-50 text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400'
            : 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200',
        )}
      >
        {invalidMessage ??
          (preview.ok
            ? describeQuotaRule(preview.rule, { models: modelNames, groups: groupNames })
            : preview.message)}
      </div>
    </div>
  )
}
