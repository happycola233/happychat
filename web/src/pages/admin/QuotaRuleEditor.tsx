import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Minus, Plus, Search } from 'lucide-react'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import type { QuotaMetric } from '@shared/types/domain'
import {
  QUOTA_DURATION_PRESET_HOURS,
  QUOTA_MAX_RULE_PRIORITY,
  describeQuotaRule,
  isQuotaCostMetric,
  isQuotaRuleNoOp,
} from '@shared/util/quota'
import { describeQuotaHours } from '@shared/util/quotaWindow'
import { Checkbox } from '../../components/ui/Checkbox'
import { Select } from '../../components/ui/Select'
import { fieldLabelClass, inputClass } from '../../components/ui/controlStyles'
import { buildModelConfigHints } from './modelConfigLabels'
import {
  draftExemptionChoice,
  ruleFromDraft,
  withExemptionChoice,
  withQuotaRuleUnlimited,
  type QuotaExemptionChoice,
  type QuotaRuleDraft,
  type QuotaScopeType,
  type QuotaWindowChoice,
} from './quotaRuleDrafts'

/** 限制什么、用完会怎样：说明直接写给配置的人看。 */
const QUOTA_METRIC_OPTIONS: { value: QuotaMetric; label: string; description: string }[] = [
  { value: 'cost', label: '消费金额', description: '文字和生图一起算，用完后不能使用' },
  { value: 'chat_cost', label: '文字消费', description: '只算文字，用完后不能聊天' },
  { value: 'image_cost', label: '生图消费', description: '只算生图，用完后只停生图' },
  { value: 'images', label: '生图张数', description: '按图片张数算，用完后只停生图' },
  { value: 'requests', label: '请求次数', description: '每次成功请求算 1 次' },
]

const EXEMPTION_OPTIONS: { value: QuotaExemptionChoice; label: string; hint: string }[] = [
  { value: 'all', label: '文字和生图', hint: '这些模型不受优先级更低的规则限制。' },
  { value: 'chat', label: '只豁免文字', hint: '文字不受限，生图仍按其他规则计算。' },
  { value: 'image', label: '只豁免生图', hint: '生图不受限，文字仍按其他规则计算。' },
]

const WINDOW_OPTIONS: { value: QuotaWindowChoice; label: string }[] = [
  { value: 'day', label: '每天' },
  { value: 'week', label: '每周' },
  { value: 'month', label: '每月' },
  { value: 'anchored', label: '从首次请求起算' },
  { value: 'rolling', label: '滚动窗口' },
  { value: 'total', label: '永久累计（不重置）' },
]

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
        'flex min-h-8 flex-1 items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-medium transition',
        active
          ? 'bg-sky-100/80 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
          : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
      )}
    >
      {children}
    </button>
  )
}

function Field({
  label,
  children,
  aside,
}: {
  label: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
        <span className={clsx(fieldLabelClass, 'mb-0')}>{label}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** 目标多选：可搜索的勾选列表，带全选与清空。 */
function TargetPicker({
  items,
  selected,
  onChange,
  noun,
}: {
  items: { id: string; label: string; hint?: string }[]
  selected: string[]
  onChange: (next: string[]) => void
  noun: string
}) {
  const [search, setSearch] = useState('')
  const keyword = search.trim().toLowerCase()
  const visible = keyword
    ? items.filter((item) => `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(keyword))
    : items
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-400 dark:border-neutral-700">
        还没有{noun}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-2.5 dark:border-neutral-800">
        <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`搜索${noun}`}
          aria-label={`搜索${noun}`}
          className="min-h-8 min-w-0 flex-1 bg-transparent text-xs text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
        />
        <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">
          已选 {selected.length}
        </span>
        <button
          type="button"
          onClick={() => onChange([...new Set([...selected, ...visible.map((item) => item.id)])])}
          className="shrink-0 rounded px-1 text-[11px] text-sky-600 hover:underline dark:text-sky-400"
        >
          全选
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => onChange([])}
          className="shrink-0 rounded px-1 text-[11px] text-neutral-500 hover:underline disabled:opacity-40 dark:text-neutral-400"
        >
          清空
        </button>
      </div>
      <div className="hc-scrollbar max-h-56 overflow-y-auto py-1">
        {visible.map((item) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-sm transition hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <Checkbox
              checked={selected.includes(item.id)}
              onChange={(checked) =>
                onChange(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
              }
              ariaLabel={item.label}
            />
            <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
              {item.label}
            </span>
            {item.hint && (
              <span className="max-w-[55%] shrink-0 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                {item.hint}
              </span>
            )}
          </label>
        ))}
        {visible.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-neutral-400">没有匹配的{noun}</p>
        )}
      </div>
    </div>
  )
}

function PriorityStepper({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const parsed = value.trim() === '' ? 0 : Number(value)
  const current = Number.isInteger(parsed) ? parsed : 0
  const bump = (delta: number) => {
    onChange(String(Math.min(QUOTA_MAX_RULE_PRIORITY, Math.max(0, current + delta))))
  }

  return (
    <div className="inline-flex h-9 shrink-0 items-center overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
      <button
        type="button"
        aria-label="降低优先级"
        disabled={current <= 0}
        onClick={() => bump(-1)}
        className="flex h-full w-8 items-center justify-center text-neutral-400 transition hover:bg-neutral-50 hover:text-neutral-600 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        aria-label="规则优先级"
        className="h-full w-11 border-x border-neutral-200 bg-white text-center text-[13px] tabular-nums text-neutral-800 outline-none focus:bg-sky-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:bg-sky-950/40"
      />
      <button
        type="button"
        aria-label="提高优先级"
        disabled={current >= QUOTA_MAX_RULE_PRIORITY}
        onClick={() => bump(1)}
        className="flex h-full w-8 items-center justify-center text-neutral-400 transition hover:bg-neutral-50 hover:text-neutral-600 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * 单条额度规则的表单，按「类型 → 适用于 → 限制什么 / 豁免什么 → 优先级」从上到下填写。
 * 豁免不计量也不重置，因此只问放行哪部分用量；底部摘要与管理端列表共用 `describeQuotaRule`。
 */
export function QuotaRuleEditor({
  draft,
  models,
  groups,
  onChange,
  invalidMessage,
  autoFocus = false,
}: {
  draft: QuotaRuleDraft
  models: AdminModelDTO[]
  groups: AdminModelGroupDTO[]
  onChange: (next: QuotaRuleDraft) => void
  /** 保存时由外层填入的错误提示 */
  invalidMessage?: string
  autoFocus?: boolean
}) {
  const patch = (changes: Partial<QuotaRuleDraft>) => onChange({ ...draft, ...changes })
  const preview = ruleFromDraft(draft)
  const groupNames = useMemo(
    () => Object.fromEntries(groups.map((group) => [group.id, group.name])),
    [groups],
  )
  const modelItems = useMemo(() => {
    const duplicates = buildModelConfigHints(models, groups)
    return models.map((model) => ({
      id: model.id,
      label: model.displayName,
      hint:
        duplicates.get(model.id) ??
        (model.groupId ? (groupNames[model.groupId] ?? '未知分组') : '未分组'),
    }))
  }, [models, groups, groupNames])
  const modelNames = Object.fromEntries(models.map((model) => [model.id, model.displayName]))
  const cost = isQuotaCostMetric(draft.metric)
  const exemption = draftExemptionChoice(draft)
  // 0 档豁免不接管任何规则，与「不写这条规则」完全等价——直接在摘要位提醒。
  const noOpHint =
    preview.ok && isQuotaRuleNoOp(preview.rule)
      ? '这条豁免不会起作用：优先级要比被放行的规则更大。'
      : null
  const noun = draft.scopeType === 'groups' ? '分组' : '模型'

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <Field label="类型">
          <div className={SEGMENT_CLASS}>
            <SegmentButton
              active={!draft.unlimited}
              onClick={() => onChange(withQuotaRuleUnlimited(draft, false))}
            >
              限额
            </SegmentButton>
            <SegmentButton
              active={draft.unlimited}
              onClick={() => onChange(withQuotaRuleUnlimited(draft, true))}
            >
              豁免
            </SegmentButton>
          </div>
        </Field>
        <Field label="备注">
          <input
            value={draft.label}
            onChange={(event) => patch({ label: event.target.value })}
            placeholder={draft.unlimited ? '可选，如「免费模型」' : '可选，如「每月额度」'}
            maxLength={40}
            autoFocus={autoFocus}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="适用于">
        <div className={SEGMENT_CLASS}>
          {(
            [
              ['all', '全部模型'],
              ['models', '指定模型'],
              ['groups', '模型分组'],
            ] as const
          ).map(([value, label]) => (
            <SegmentButton
              key={value}
              active={draft.scopeType === value}
              onClick={() =>
                draft.scopeType !== value &&
                patch({ scopeType: value as QuotaScopeType, targetIds: [] })
              }
            >
              {label}
            </SegmentButton>
          ))}
        </div>
        {draft.scopeType !== 'all' && (
          <div className="mt-2 space-y-2">
            <TargetPicker
              noun={noun}
              items={
                draft.scopeType === 'models'
                  ? modelItems
                  : groups.map((group) => ({
                      id: group.id,
                      label: group.name,
                      hint: `${group.modelCount} 个模型`,
                    }))
              }
              selected={draft.targetIds}
              onChange={(targetIds) => patch({ targetIds })}
            />
            {!draft.unlimited && draft.targetIds.length > 1 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-xs text-neutral-500 dark:text-neutral-400">额度</span>
                <div className={clsx(SEGMENT_CLASS, 'min-w-[16rem] flex-1 sm:flex-none')}>
                  <SegmentButton
                    active={draft.mode === 'each'}
                    onClick={() => patch({ mode: 'each' })}
                  >
                    每个{noun}各自独立
                  </SegmentButton>
                  <SegmentButton
                    active={draft.mode === 'shared'}
                    onClick={() => patch({ mode: 'shared' })}
                  >
                    所选{noun}共享一份
                  </SegmentButton>
                </div>
              </div>
            )}
          </div>
        )}
      </Field>

      {draft.unlimited ? (
        <Field label="豁免什么">
          <div className={SEGMENT_CLASS}>
            {EXEMPTION_OPTIONS.map((option) => (
              <SegmentButton
                key={option.value}
                active={exemption === option.value}
                onClick={() => onChange(withExemptionChoice(draft, option.value))}
              >
                {option.label}
              </SegmentButton>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
            {EXEMPTION_OPTIONS.find((option) => option.value === exemption)!.hint}
          </p>
        </Field>
      ) : (
        <>
          <Field label="限制什么">
            <Select
              aria-label="限制什么"
              size="md"
              className="w-full"
              value={draft.metric}
              onChange={(event) => patch({ metric: event.target.value as QuotaMetric })}
              options={QUOTA_METRIC_OPTIONS}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="上限"
              aside={
                cost ? (
                  <div className="flex gap-0.5 rounded-md bg-neutral-100 p-0.5 dark:bg-neutral-800">
                    {(['USD', 'CNY'] as const).map((currency) => (
                      <button
                        key={currency}
                        type="button"
                        aria-pressed={(draft.currency ?? 'USD') === currency}
                        onClick={() => patch({ currency })}
                        className={clsx(
                          'rounded px-1.5 text-[11px] leading-5 transition',
                          (draft.currency ?? 'USD') === currency
                            ? 'bg-sky-100/80 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                            : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400',
                        )}
                      >
                        {currency === 'USD' ? '美元' : '人民币'}
                      </button>
                    ))}
                  </div>
                ) : undefined
              }
            >
              <div className="relative">
                {cost && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                    {draft.currency === 'CNY' ? '¥' : '$'}
                  </span>
                )}
                <input
                  value={draft.limitInput}
                  onChange={(event) => patch({ limitInput: event.target.value })}
                  inputMode="decimal"
                  aria-label="额度上限"
                  placeholder={cost ? '10' : draft.metric === 'images' ? '20' : '300'}
                  className={clsx(`${inputClass} pr-10 tabular-nums`, cost ? 'pl-7' : 'pl-3')}
                />
                {!cost && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                    {draft.metric === 'images' ? '张' : '次'}
                  </span>
                )}
              </div>
            </Field>
            <Field label="周期">
              <Select
                aria-label="周期"
                size="md"
                className="w-full"
                value={draft.windowChoice}
                onChange={(event) =>
                  patch({ windowChoice: event.target.value as QuotaWindowChoice })
                }
                options={WINDOW_OPTIONS}
              />
            </Field>
          </div>
          {(draft.windowChoice === 'rolling' || draft.windowChoice === 'anchored') && (
            <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-800/50">
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={draft.durationHoursInput}
                  onChange={(event) => patch({ durationHoursInput: event.target.value })}
                  inputMode="numeric"
                  aria-label={
                    draft.windowChoice === 'rolling' ? '滚动窗口小时数' : '固定周期小时数'
                  }
                  className={`${inputClass} !w-20 tabular-nums`}
                />
                <span className="text-xs text-neutral-500">小时</span>
                <div className="ml-auto flex gap-1">
                  {QUOTA_DURATION_PRESET_HOURS.map((hours) => (
                    <button
                      key={hours}
                      type="button"
                      onClick={() => patch({ durationHoursInput: String(hours) })}
                      className={clsx(
                        'rounded-md px-1.5 py-0.5 text-[11px] transition',
                        Number(draft.durationHoursInput) === hours
                          ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                          : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
                      )}
                    >
                      {describeQuotaHours(hours)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
                {draft.windowChoice === 'anchored'
                  ? '首次请求开始计时，到期一次性清零；没有请求时不计时。'
                  : '始终统计最近这段时间，旧用量会逐步释放。'}
              </p>
            </div>
          )}
        </>
      )}

      <Field label="优先级">
        <div className="flex items-center gap-3">
          <PriorityStepper
            value={draft.priorityInput}
            onChange={(priorityInput) => patch({ priorityInput })}
          />
          <p className="min-w-0 flex-1 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
            {draft.unlimited
              ? '要比被放行的规则大。'
              : '同一模型的文字和生图，各自只按优先级最高的规则计算；同级规则同时生效。'}
          </p>
        </div>
      </Field>

      {/* 实时摘要 / 校验 */}
      <div
        role={invalidMessage || !preview.ok || noOpHint ? 'alert' : undefined}
        className={clsx(
          'rounded-lg px-3 py-2 text-xs leading-5',
          preview.ok && !invalidMessage && !noOpHint
            ? 'bg-sky-50/70 text-sky-800 dark:bg-sky-500/10 dark:text-sky-200'
            : 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200',
        )}
      >
        {invalidMessage ??
          (preview.ok
            ? (noOpHint ??
              describeQuotaRule(preview.rule, { models: modelNames, groups: groupNames }))
            : preview.message)}
      </div>
    </div>
  )
}
