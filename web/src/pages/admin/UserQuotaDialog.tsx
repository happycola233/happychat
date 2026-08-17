import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Gift, RotateCcw, Trash2 } from 'lucide-react'
import type { AdminQuotaPolicyDTO, QuotaBucketUsageDTO, QuotaPreviewDTO } from '@shared/types/api'
import type {
  QuotaLimit,
  QuotaRule,
  QuotaRuleOverride,
  QuotaWindow,
  UserQuotaOverrides,
} from '@shared/types/domain'
import {
  describeQuotaRule,
  describeQuotaRuleGroupTitle,
  formatQuotaAmount,
  formatQuotaLimit,
  groupQuotaBucketsByRule,
} from '@shared/util/quota'
import { describeQuotaWindow } from '@shared/util/quotaWindow'
import {
  createUserQuotaGrant,
  getUserQuotaDetail,
  listAdminModelGroups,
  listAdminModels,
  previewUserQuota,
  resetUserQuotaPeriod,
  revokeQuotaAdjustment,
  updateUserQuota,
} from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { Toggle } from '../../components/ui/Toggle'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { QuotaRuleList } from './QuotaRuleList'
import { draftFromRule, draftsToRules, type QuotaRuleDraft } from './quotaRuleDrafts'
import { hasUnsavedQuotaDefinitionChanges, hiddenQuotaRuleOverrides } from './userQuotaDraftState'

type OverrideMode = 'inherit' | 'override' | 'disabled'

interface RuleOverrideDraft {
  mode: OverrideMode
  limitUnlimited: boolean
  limitInput: string
  /** 空串=沿用模板周期 */
  windowChoice: '' | 'day' | 'week' | 'month' | 'total'
}

const WINDOW_OPTIONS = [
  { value: '', label: '沿用模板周期' },
  { value: 'day', label: '每天' },
  { value: 'week', label: '每周' },
  { value: 'month', label: '每月' },
  { value: 'total', label: '永久累计' },
]

function initialOverrideDraft(rule: QuotaRule, overrides: UserQuotaOverrides): RuleOverrideDraft {
  const override = overrides.rules?.[rule.id]
  if (override?.disabled) {
    return { mode: 'disabled', limitUnlimited: false, limitInput: '', windowChoice: '' }
  }
  if (override?.limit || override?.window) {
    return {
      mode: 'override',
      limitUnlimited: override.limit?.kind === 'unlimited',
      limitInput: override.limit?.kind === 'amount' ? String(override.limit.value) : '',
      windowChoice:
        override.window?.type === 'calendar'
          ? override.window.period
          : override.window?.type === 'total'
            ? 'total'
            : '',
    }
  }
  return {
    mode: 'inherit',
    limitUnlimited: rule.limit.kind === 'unlimited',
    limitInput: rule.limit.kind === 'amount' ? String(rule.limit.value) : '',
    windowChoice: '',
  }
}

/** 覆写草稿 → 覆写载荷；返回 null 表示该规则保持继承（不写入覆写）。 */
function overridePayload(draft: RuleOverrideDraft): QuotaRuleOverride | null {
  if (draft.mode === 'disabled') return { disabled: true }
  if (draft.mode === 'inherit') return null
  const limit: QuotaLimit | undefined = draft.limitUnlimited
    ? { kind: 'unlimited' }
    : Number(draft.limitInput) > 0
      ? { kind: 'amount', value: Number(draft.limitInput) }
      : undefined
  const window: QuotaWindow | undefined =
    draft.limitUnlimited || draft.windowChoice === ''
      ? undefined
      : draft.windowChoice === 'total'
        ? { type: 'total' }
        : { type: 'calendar', period: draft.windowChoice }
  // 覆写模式但没填任何有效值时按继承处理，避免写入空覆写被 zod 拒绝。
  if (!limit && !window) return null
  return { ...(limit ? { limit } : {}), ...(window ? { window } : {}) }
}

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  policy: {
    label: '继承',
    className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
  },
  override: {
    label: '已覆写',
    className: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
  },
  user: {
    label: '专属',
    className: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
  },
}

/** 桶的一行中文说明，用于重置确认框与无障碍名称。 */
function describeBucket(rule: QuotaBucketUsageDTO): string {
  const target = rule.bucketLabel ? `${rule.bucketLabel} · ` : ''
  if (rule.limit.kind === 'unlimited') return `${target}豁免`
  return `${target}${describeQuotaWindow(rule.window)}${rule.metric === 'cost' ? '消费' : '请求'}`
}

/** 预览里的一条桶用量（保存后会立即生效的真实数字）。 */
function PreviewRow({
  rule,
  onReset,
  nested = false,
}: {
  rule: QuotaBucketUsageDTO
  /** 提供时显示单桶重置按钮；失效桶与被接管的桶不给（重置它们没有意义） */
  onReset?: () => void
  nested?: boolean
}) {
  const percent = Math.min(100, Math.round((rule.percent ?? 0) * 100))
  const badge = SOURCE_BADGE[rule.source]!
  return (
    <div className={clsx('py-2', nested && 'pl-3')}>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={clsx('shrink-0 rounded px-1.5 py-px text-[10px] font-medium', badge.className)}
        >
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">
          {describeBucket(rule)}
        </span>
        {rule.priority > 0 && (
          <span
            title="规则优先级：数字越大越优先"
            className="shrink-0 rounded bg-neutral-100 px-1.5 py-px text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          >
            优先 {rule.priority}
          </span>
        )}
        {rule.shadowed && (
          <span
            title="该桶内的模型都已被更高优先级的规则接管，这条规则对它们不计量也不拦截"
            className="shrink-0 rounded bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-600 dark:bg-violet-500/10 dark:text-violet-300"
          >
            已被接管
          </span>
        )}
        {rule.invalid && (
          <span
            title="规则指向的模型或分组已不存在，不参与拦截"
            className="shrink-0 rounded bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:bg-amber-400/10 dark:text-amber-200"
          >
            已失效
          </span>
        )}
        {rule.limit.kind !== 'unlimited' && !rule.periodActive && (
          <span className="shrink-0 rounded bg-sky-50 px-1.5 py-px text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
            首次请求后计时
          </span>
        )}
        <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
          {formatQuotaAmount(rule.metric, rule.used)} /{' '}
          {rule.effectiveLimit === null ? '∞' : formatQuotaAmount(rule.metric, rule.effectiveLimit)}
        </span>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            title="重置这个额度的当前周期"
            aria-label={`重置「${describeBucket(rule)}」的当前周期`}
            className="shrink-0 rounded p-0.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>
      {rule.effectiveLimit !== null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className={clsx(
              'h-full rounded-full',
              rule.blocked ? 'bg-rose-500 dark:bg-rose-400' : 'bg-sky-500 dark:bg-sky-400',
            )}
            style={{ width: `${Math.max(percent > 0 ? 2 : 0, percent)}%` }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 单个用户的限额配置弹窗：策略绑定 → 逐规则覆写 → 专属规则 → 临时额度 / 重置 → 生效预览。
 *
 * 预览是这个面板的关键：管理员改动上限后，立刻能看到「保存后该用户会不会当场被限住」，
 * 而不是保存完再去猜。
 */
export function UserQuotaDialog({
  open,
  userId,
  username,
  policies,
  onClose,
}: {
  open: boolean
  userId: string
  username: string
  policies: AdminQuotaPolicyDTO[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data: detail, isLoading } = useQuery({
    queryKey: ['admin', 'quota', 'user', userId],
    queryFn: () => getUserQuotaDetail(userId),
    enabled: open,
  })
  const { data: models } = useQuery({ queryKey: ['admin', 'models'], queryFn: listAdminModels })
  const { data: groups } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: listAdminModelGroups,
  })

  const [policyId, setPolicyId] = useState<string | null | undefined>(undefined)
  const [paused, setPaused] = useState<boolean | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, RuleOverrideDraft>>({})
  const [extraDrafts, setExtraDrafts] = useState<QuotaRuleDraft[] | undefined>(undefined)
  const [extraInvalid, setExtraInvalid] = useState<{ index: number; message: string } | null>(null)
  const [grantForm, setGrantForm] = useState<{ ruleId: string; bucketKey: string; amount: string }>(
    {
      ruleId: '',
      bucketKey: '',
      amount: '',
    },
  )

  // 详情到达后在渲染期同步一次草稿（effect 要等一帧，会先把空表单刷到屏幕上）。
  const syncedKeyRef = useRef<string | null>(null)
  const detailKey = detail
    ? `${detail.userId}:${detail.policyId ?? ''}:${detail.enforcementPaused}`
    : null
  if (detail && detailKey !== syncedKeyRef.current) {
    syncedKeyRef.current = detailKey
    setPolicyId(detail.policyId)
    setPaused(detail.enforcementPaused)
    setNote(detail.note ?? '')
    setExtraDrafts((detail.overrides.extraRules ?? []).map(draftFromRule))
    setExtraInvalid(null)
    setOverrideDrafts({})
  }

  const effectivePolicy = policies.find((policy) => policy.id === (policyId ?? null)) ?? null
  const defaultPolicy = policies.find((policy) => policy.isDefault) ?? null
  const templateRules = (policyId ? effectivePolicy?.rules : defaultPolicy?.rules) ?? []

  // 模板规则的覆写草稿按需初始化：切换策略后新规则自动取继承态。
  const overrideFor = (rule: QuotaRule): RuleOverrideDraft =>
    overrideDrafts[rule.id] ?? initialOverrideDraft(rule, detail?.overrides ?? {})

  const buildOverrides = (): UserQuotaOverrides => {
    const rules: NonNullable<UserQuotaOverrides['rules']> = hiddenQuotaRuleOverrides(
      detail?.overrides ?? {},
      templateRules.map((rule) => rule.id),
    )
    for (const rule of templateRules) {
      const payload = overridePayload(overrideFor(rule))
      if (payload) rules[rule.id] = payload
    }
    const extras = draftsToRules(extraDrafts ?? [])
    return {
      ...(Object.keys(rules).length > 0 ? { rules } : {}),
      ...(extras.ok && extras.rules.length > 0 ? { extraRules: extras.rules } : {}),
    }
  }

  // 每次渲染重算：构造只是几十个字段的对象映射，比维护一串依赖项更不容易出错，
  // 查询键用它的 JSON 快照，因此不需要引用稳定性。
  const draftOverrides: UserQuotaOverrides = detail ? buildOverrides() : {}
  // 预览要打网络：把序列化快照防抖 350ms（与导出预览同一口径），避免逐字符发请求。
  const overridesSnapshot = JSON.stringify(draftOverrides)
  const debouncedOverridesSnapshot = useDebouncedValue(overridesSnapshot, 350)

  const { data: preview, isFetching: isPreviewFetching } = useQuery<QuotaPreviewDTO>({
    queryKey: [
      'admin',
      'quota',
      'preview',
      userId,
      policyId ?? '',
      debouncedOverridesSnapshot,
      paused ?? false,
    ],
    queryFn: () =>
      previewUserQuota({
        userId,
        policyId: policyId ?? null,
        overrides: JSON.parse(debouncedOverridesSnapshot) as UserQuotaOverrides,
        enforcementPaused: paused ?? false,
      }),
    enabled: open && Boolean(detail),
    placeholderData: (previousData) => previousData,
  })
  const quotaDefinitionDirty = detail
    ? hasUnsavedQuotaDefinitionChanges(detail.policyId, policyId, detail.overrides, draftOverrides)
    : false
  const canAdjustSavedQuota = !quotaDefinitionDirty
  const previewActionsReady =
    canAdjustSavedQuota && overridesSnapshot === debouncedOverridesSnapshot && !isPreviewFetching

  const save = useMutation({
    mutationFn: () => {
      const extras = draftsToRules(extraDrafts ?? [])
      if (!extras.ok) {
        setExtraInvalid({ index: extras.index, message: extras.message })
        throw new Error(`专属规则第 ${extras.index + 1} 条：${extras.message}`)
      }
      setExtraInvalid(null)
      return updateUserQuota(userId, {
        policyId: policyId ?? null,
        overrides: buildOverrides(),
        enforcementPaused: paused ?? false,
        note: (note ?? '').trim() || null,
      })
    },
    onSuccess: () => {
      toast.success('已保存')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'quota'] })
      void queryClient.invalidateQueries({ queryKey: ['quota', 'me'] })
      onClose()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'quota'] })
    void queryClient.invalidateQueries({ queryKey: ['quota', 'me'] })
  }

  const resetPeriod = useMutation({
    mutationFn: (input: { ruleId?: string; bucketKey?: string }) =>
      resetUserQuotaPeriod(userId, input),
    onSuccess: () => {
      toast.success('已重置当前周期（历史用量记录保留）')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '重置失败'),
  })

  const addGrant = useMutation({
    mutationFn: () =>
      createUserQuotaGrant(userId, {
        ruleId: grantForm.ruleId,
        bucketKey: grantForm.bucketKey || null,
        amount: Number(grantForm.amount),
      }),
    onSuccess: () => {
      toast.success('已添加临时额度')
      setGrantForm({ ruleId: '', bucketKey: '', amount: '' })
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '添加失败'),
  })

  const revokeGrant = useMutation({
    mutationFn: revokeQuotaAdjustment,
    onSuccess: () => {
      toast.success('已撤销')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '撤销失败'),
  })

  const activeGrants = (detail?.adjustments ?? []).filter(
    (row) => row.kind === 'grant' && row.active,
  )
  // 周期调整只使用已保存快照；预览可能包含尚未落库的策略、专属规则或周期改动。
  const grantableRules = (detail?.rules ?? []).filter(
    (rule) => rule.limit.kind === 'amount' && rule.periodActive && !rule.invalid && !rule.shadowed,
  )
  const hasResettablePeriods = (detail?.rules ?? []).some(
    (rule) => rule.limit.kind === 'amount' && rule.periodActive && !rule.invalid && !rule.shadowed,
  )
  const grantRule = grantableRules.find((rule) => rule.ruleId === grantForm.ruleId)
  const grantBuckets = grantableRules.filter((rule) => rule.ruleId === grantForm.ruleId)
  const requiresBucket = grantRule ? grantBuckets.some((rule) => rule.bucketKey !== null) : false

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="form"
      title={`限额配置 · ${username}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            保存
          </Button>
        </>
      }
    >
      {isLoading || !detail ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* 1. 策略绑定与暂停 */}
          <section className="space-y-3">
            <Select
              label="限额策略"
              className="w-full"
              value={policyId ?? ''}
              onChange={(event) => setPolicyId(event.target.value || null)}
              options={[
                {
                  value: '',
                  label: defaultPolicy
                    ? `跟随默认策略（${defaultPolicy.name}）`
                    : '跟随默认策略（当前未设置，等于无限额度）',
                },
                ...policies.map((policy) => ({ value: policy.id, label: policy.name })),
              ]}
            />
            <div className="flex items-start justify-between gap-4 rounded-xl bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800/50">
              <div>
                <div className="text-sm text-neutral-800 dark:text-neutral-100">暂停限额</div>
                <div className="mt-0.5 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
                  暂停期间不拦截请求，但用量照常累计；恢复后按累计用量立即重新判定。
                </div>
              </div>
              <Toggle checked={paused ?? false} onChange={setPaused} ariaLabel="暂停限额" />
            </div>
            <input
              value={note ?? ''}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              placeholder="备注（可选，仅管理员可见）"
              className="w-full rounded-lg border border-transparent bg-neutral-100 px-2.5 py-1.5 text-sm text-neutral-800 outline-none transition placeholder:text-neutral-400 focus:border-neutral-300 focus:bg-white dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-600 dark:focus:bg-neutral-900"
            />
          </section>

          {/* 2. 逐规则覆写 */}
          <section>
            <h3 className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
              继承规则的覆写
            </h3>
            {templateRules.length === 0 ? (
              <p className="rounded-xl border border-dashed border-neutral-200 px-3 py-3 text-xs text-neutral-400 dark:border-neutral-700">
                当前策略没有规则（无限额度），可在下方添加只对该用户生效的专属规则。
              </p>
            ) : (
              <div
                role="list"
                className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700"
              >
                {templateRules.map((rule) => {
                  const draft = overrideFor(rule)
                  const patch = (changes: Partial<RuleOverrideDraft>) =>
                    setOverrideDrafts((current) => ({
                      ...current,
                      [rule.id]: { ...draft, ...changes },
                    }))
                  return (
                    <div key={rule.id} role="listitem" className="px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-neutral-800 dark:text-neutral-100">
                            {rule.label || describeQuotaRule(rule)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                            模板：{formatQuotaLimit(rule.metric, rule.limit)}
                            {rule.limit.kind === 'unlimited'
                              ? ''
                              : ` · ${describeQuotaWindow(rule.window)}`}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
                          {(
                            [
                              ['inherit', '继承'],
                              ['override', '覆写'],
                              ['disabled', '停用'],
                            ] as const
                          ).map(([mode, label]) => (
                            <button
                              key={mode}
                              type="button"
                              aria-pressed={draft.mode === mode}
                              onClick={() => patch({ mode })}
                              className={clsx(
                                'rounded-md px-2 py-1 text-[11px] font-medium transition',
                                draft.mode === mode
                                  ? 'bg-white text-neutral-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {draft.mode === 'override' && (
                        <div
                          className={clsx(
                            'mt-3 grid gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800',
                            draft.limitUnlimited
                              ? 'sm:grid-cols-[1fr_auto]'
                              : 'sm:grid-cols-[1fr_1fr_auto]',
                          )}
                        >
                          <div className="relative">
                            <input
                              value={draft.limitInput}
                              disabled={draft.limitUnlimited}
                              onChange={(event) => patch({ limitInput: event.target.value })}
                              inputMode="decimal"
                              placeholder={rule.metric === 'cost' ? '新的金额上限' : '新的次数上限'}
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm tabular-nums text-neutral-800 outline-none transition focus:border-sky-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                            />
                          </div>
                          {!draft.limitUnlimited && (
                            <Select
                              className="w-full"
                              aria-label="覆写周期"
                              value={draft.windowChoice}
                              onChange={(event) =>
                                patch({
                                  windowChoice: event.target
                                    .value as RuleOverrideDraft['windowChoice'],
                                })
                              }
                              options={WINDOW_OPTIONS}
                            />
                          )}
                          <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-neutral-500 dark:text-neutral-400">
                            不限
                            <Toggle
                              checked={draft.limitUnlimited}
                              onChange={(checked) => patch({ limitUnlimited: checked })}
                              ariaLabel="覆写为无限额度"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 3. 专属规则 */}
          <section>
            <QuotaRuleList
              title="用户专属规则"
              description="只对该用户生效的额外限制，不影响策略里的其他人。拖动调整展示顺序，覆盖关系由优先级决定。"
              emptyMessage="还没有专属规则。需要给这个人加一条别人没有的限制或豁免时，从下方添加。"
              addLabel="添加专属规则"
              drafts={extraDrafts ?? []}
              onChange={(next) => {
                setExtraDrafts(next)
                setExtraInvalid(null)
              }}
              models={models ?? []}
              groups={groups ?? []}
              invalidIndex={extraInvalid?.index ?? null}
              invalidMessage={extraInvalid?.message}
            />
          </section>

          {/* 4. 生效预览（真实用量） */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                保存后的生效结果
              </h3>
              <button
                type="button"
                disabled={!hasResettablePeriods || !canAdjustSavedQuota}
                title={quotaDefinitionDirty ? '请先保存当前配置，再重置周期' : undefined}
                onClick={async () => {
                  if (
                    await askConfirm({
                      title: '重置当前周期',
                      description:
                        '该用户全部规则的本周期用量将重新计算，历史统计不受影响。首次请求起算的固定周期会清空，等下次请求后再开始。',
                      confirmLabel: '重置',
                    })
                  ) {
                    resetPeriod.mutate({})
                  }
                }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-neutral-400 transition enabled:hover:bg-neutral-100 enabled:hover:text-neutral-600 disabled:cursor-not-allowed disabled:opacity-40 dark:enabled:hover:bg-neutral-800 dark:enabled:hover:text-neutral-300"
              >
                <RotateCcw className="h-3 w-3" /> 重置全部周期
              </button>
            </div>
            {quotaDefinitionDirty && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-5 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                当前策略或规则尚未保存；请先保存，再重置周期或赠送临时额度。
              </p>
            )}
            {!preview ? (
              <div className="py-4 text-center">
                <Spinner className="h-5 w-5 text-neutral-400" />
              </div>
            ) : preview.unlimited ? (
              <p className="rounded-xl bg-neutral-50 px-3 py-3 text-xs text-neutral-500 dark:bg-neutral-800/50 dark:text-neutral-400">
                该用户将为无限额度。
              </p>
            ) : (
              <div className="rounded-xl border border-neutral-200 px-3 py-1 dark:border-neutral-700">
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {groupQuotaBucketsByRule(preview.rules).map((group) => {
                    const resetFor = (rule: QuotaBucketUsageDTO) =>
                      !previewActionsReady ||
                      !rule.periodActive ||
                      rule.invalid ||
                      rule.shadowed ||
                      rule.limit.kind === 'unlimited'
                        ? undefined
                        : async () => {
                            if (
                              await askConfirm({
                                title: '重置这个额度',
                                description:
                                  rule.window.type === 'anchored'
                                    ? `「${describeBucket(rule)}」将回到未启动，下次请求后再开始计时，其他额度与历史统计不受影响。`
                                    : `「${describeBucket(rule)}」的本周期用量将从此刻重新计算，其他额度与历史统计不受影响。`,
                                confirmLabel: '重置',
                              })
                            ) {
                              resetPeriod.mutate({
                                ruleId: rule.ruleId,
                                bucketKey: rule.bucketKey ?? undefined,
                              })
                            }
                          }
                    if (group.buckets.length === 1) {
                      const rule = group.buckets[0]!
                      return <PreviewRow key={group.ruleId} rule={rule} onReset={resetFor(rule)} />
                    }
                    return (
                      <div key={group.ruleId} className="py-1">
                        <div className="flex items-center justify-between gap-2 pt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                          <span className="truncate font-medium text-neutral-600 dark:text-neutral-300">
                            {describeQuotaRuleGroupTitle(group.buckets)}
                          </span>
                          <span className="shrink-0">各自独立</span>
                        </div>
                        {group.buckets.map((rule) => (
                          <PreviewRow
                            key={`${rule.ruleId}:${rule.bucketKey ?? ''}`}
                            rule={rule}
                            nested
                            onReset={resetFor(rule)}
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {preview && preview.blockedRules.length > 0 && (
              <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-5 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                {`保存后该用户将立即处于「额度已用尽」状态（${groupQuotaBucketsByRule(preview.blockedRules).length} 条规则触顶）`}
                {paused ? '；不过限额当前处于暂停状态，仍不会被拦截。' : '。'}
              </p>
            )}
          </section>

          {/* 5. 临时额度 */}
          <section>
            <h3 className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
              临时额度
            </h3>
            <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
              只在当前周期内叠加到上限之上，周期结束自动失效，不改动长期配置。
            </p>
            {activeGrants.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {activeGrants.map((grant) => (
                  <div
                    key={grant.id}
                    className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200"
                  >
                    <Gift className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      +{formatQuotaAmount(grant.metric, grant.amount)}
                      {grant.note ? ` · ${grant.note}` : ''}
                      {grant.expiresAt
                        ? ` · ${new Date(grant.expiresAt).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })} 失效`
                        : ''}
                    </span>
                    <button
                      type="button"
                      aria-label="撤销这笔临时额度"
                      onClick={() => revokeGrant.mutate(grant.id)}
                      className="shrink-0 rounded p-0.5 transition hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr_auto]">
              <Select
                className="w-full"
                aria-label="目标规则"
                disabled={!canAdjustSavedQuota}
                value={grantForm.ruleId}
                onChange={(event) =>
                  setGrantForm((current) => ({
                    ...current,
                    ruleId: event.target.value,
                    bucketKey: '',
                  }))
                }
                options={[
                  { value: '', label: '选择规则…' },
                  ...[...new Map(grantableRules.map((rule) => [rule.ruleId, rule])).values()].map(
                    (rule) => ({
                      value: rule.ruleId,
                      label: `${describeQuotaWindow(rule.window)}${
                        rule.metric === 'cost' ? '消费' : '请求'
                      } · ${formatQuotaLimit(rule.metric, rule.limit)}`,
                    }),
                  ),
                ]}
              />
              <input
                value={grantForm.amount}
                disabled={!canAdjustSavedQuota}
                onChange={(event) =>
                  setGrantForm((current) => ({ ...current, amount: event.target.value }))
                }
                inputMode="decimal"
                placeholder={grantRule?.metric === 'requests' ? '增加次数' : '增加金额（$）'}
                className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm tabular-nums text-neutral-800 outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                loading={addGrant.isPending}
                disabled={
                  !canAdjustSavedQuota ||
                  !grantForm.ruleId ||
                  !(Number(grantForm.amount) > 0) ||
                  (requiresBucket && !grantForm.bucketKey)
                }
                onClick={() => addGrant.mutate()}
              >
                赠送
              </Button>
            </div>
            {/* 「各自独立额度」的规则必须指定具体目标，否则一份赠送会被每个模型重复享用。 */}
            {requiresBucket && (
              <Select
                className="mt-2 w-full"
                aria-label="目标模型或分组"
                disabled={!canAdjustSavedQuota}
                value={grantForm.bucketKey}
                onChange={(event) =>
                  setGrantForm((current) => ({ ...current, bucketKey: event.target.value }))
                }
                options={[
                  { value: '', label: '选择要赠送的模型 / 分组…' },
                  ...grantBuckets
                    .filter((rule) => rule.bucketKey)
                    .map((rule) => ({
                      value: rule.bucketKey!,
                      label: rule.bucketLabel ?? rule.bucketKey!,
                    })),
                ]}
              />
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
