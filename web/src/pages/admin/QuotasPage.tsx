import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import {
  Copy,
  Infinity as InfinityIcon,
  ListChecks,
  PauseCircle,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AdminQuotaPolicyDTO, AdminUserQuotaDTO } from '@shared/types/api'
import type { AppConfigUpdateInput } from '@shared/schemas/app-config'
import { describeQuotaRule, formatQuotaAmount } from '@shared/util/quota'
import {
  batchAssignQuotaPolicy,
  deleteQuotaPolicy,
  duplicateQuotaPolicy,
  getUserQuotaDetail,
  listQuotaPolicies,
  listUserQuotas,
  setDefaultQuotaPolicy,
  updateUserQuota,
} from '../../api/admin'
import { getAppConfig, updateAppConfig } from '../../api/appConfig'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { Toggle } from '../../components/ui/Toggle'
import { PageHeader } from '../../components/ui/PageHeader'
import { cardSurface } from '../../components/ui/Card'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { formatRelative } from '../../lib/format'
import { QuotaPolicyEditor } from './QuotaPolicyEditor'
import { UserQuotaDialog } from './UserQuotaDialog'

type View = 'policies' | 'users'

/**
 * 周期边界时区选项。只列常用时区：这个设置决定「每天/每周/每月」几点重置，
 * 需要的是「站点所在地区」而不是一份完整的 IANA 目录。
 */
const QUOTA_TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: '中国标准时间（UTC+8）' },
  { value: 'Asia/Tokyo', label: '日本标准时间（UTC+9）' },
  { value: 'Asia/Singapore', label: '新加坡时间（UTC+8）' },
  { value: 'Europe/London', label: '英国时间（UTC+0/+1）' },
  { value: 'Europe/Berlin', label: '中欧时间（UTC+1/+2）' },
  { value: 'America/New_York', label: '美东时间（UTC-5/-4）' },
  { value: 'America/Los_Angeles', label: '美西时间（UTC-8/-7）' },
  { value: 'UTC', label: 'UTC' },
]

/** 用户行的状态徽标：已耗尽 / 接近上限 / 暂停 / 正常 / 无限额度。 */
function statusBadge(row: AdminUserQuotaDTO, warnThreshold: number) {
  if (row.enforcementPaused) {
    return {
      label: '限额已暂停',
      className: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    }
  }
  if (row.unlimited) {
    return {
      label: '无限额度',
      className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
    }
  }
  if (row.blocked) {
    return {
      label: '已耗尽',
      className: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
    }
  }
  if ((row.highlight?.percent ?? 0) >= warnThreshold) {
    return {
      label: '接近上限',
      className: 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-200',
    }
  }
  return {
    label: '正常',
    className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  }
}

function PolicyCard({
  policy,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
}: {
  policy: AdminQuotaPolicyDTO
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  return (
    <div className={clsx(cardSurface, 'p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {policy.name}
            </h3>
            {policy.isDefault && (
              <span className="shrink-0 rounded bg-sky-50 px-1.5 py-px text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                默认
              </span>
            )}
          </div>
          {policy.description && (
            <p className="mt-0.5 truncate text-xs text-neutral-400 dark:text-neutral-500">
              {policy.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!policy.isDefault && (
            <button
              type="button"
              onClick={onSetDefault}
              title="设为默认策略"
              aria-label="设为默认策略"
              className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <Star className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onDuplicate}
            title="复制策略"
            aria-label="复制策略"
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="编辑策略"
            aria-label="编辑策略"
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="删除策略"
            aria-label="删除策略"
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {policy.rules.length === 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <InfinityIcon className="h-3 w-3" /> 无限额度
          </span>
        ) : (
          policy.rules.map((rule) => (
            <span
              key={rule.id}
              className="rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {rule.label ? `${rule.label}：` : ''}
              {describeQuotaRule(rule)}
            </span>
          ))
        )}
      </div>

      <div className="mt-3 text-[11px] text-neutral-400 dark:text-neutral-500">
        {policy.boundUserCount} 位用户使用中
        {policy.isDefault && '（含未单独指派的用户）'}
      </div>
    </div>
  )
}

/**
 * 用户限额管理页：策略模板与逐用户配置两个视图。
 *
 * 策略视图管理「模板」，用户视图管理「谁用哪个模板 + 个别覆写」，
 * 批量交互沿用模型页的语言（行首多选 + 底部悬浮条），降低学习成本。
 */
export default function QuotasPage() {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('policies')
  const [editingPolicy, setEditingPolicy] = useState<AdminQuotaPolicyDTO | null | undefined>(
    undefined,
  )
  const [batchMode, setBatchMode] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [batchPolicyId, setBatchPolicyId] = useState('')
  const [dialogUser, setDialogUser] = useState<AdminUserQuotaDTO | null>(null)
  const [search, setSearch] = useState('')

  const { data: config } = useQuery({ queryKey: ['admin', 'app-config'], queryFn: getAppConfig })
  const { data: policies, isLoading: loadingPolicies } = useQuery({
    queryKey: ['admin', 'quota', 'policies'],
    queryFn: listQuotaPolicies,
  })
  const { data: users, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin', 'quota', 'users'],
    queryFn: listUserQuotas,
    enabled: view === 'users',
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'quota'] })
    void queryClient.invalidateQueries({ queryKey: ['quota', 'me'] })
  }

  const toggleQuota = useMutation({
    mutationFn: (quotaEnabled: boolean) => updateAppConfig({ quotaEnabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'app-config'] })
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '操作失败'),
  })

  // 时区 / 周起始 / 预警阈值：改动会立刻影响所有人的周期边界，切换即保存。
  const saveConfig = useMutation({
    mutationFn: (patch: AppConfigUpdateInput) => updateAppConfig(patch),
    onSuccess: () => {
      toast.success('已保存')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'app-config'] })
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })

  const removePolicy = useMutation({
    mutationFn: deleteQuotaPolicy,
    onSuccess: (result) => {
      toast.success(
        result.releasedUsers > 0
          ? `已删除，${result.releasedUsers} 位用户已回退到默认策略`
          : '已删除',
      )
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '删除失败'),
  })

  const duplicate = useMutation({
    mutationFn: duplicateQuotaPolicy,
    onSuccess: () => {
      toast.success('已复制策略')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '复制失败'),
  })

  const makeDefault = useMutation({
    mutationFn: setDefaultQuotaPolicy,
    onSuccess: () => {
      toast.success('已设为默认策略')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '操作失败'),
  })

  const batchAssign = useMutation({
    mutationFn: () =>
      batchAssignQuotaPolicy({
        userIds: selectedUserIds,
        policyId: batchPolicyId || null,
      }),
    onSuccess: (result) => {
      toast.success(`已修改 ${result.updated} 位用户的策略`)
      setBatchMode(false)
      setSelectedUserIds([])
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '批量修改失败'),
  })

  const togglePause = useMutation({
    // PUT 是整体替换：必须先读回该用户当前的覆写再写，否则一键暂停会顺手清掉他的覆写配置。
    mutationFn: async (row: AdminUserQuotaDTO) => {
      const detail = await getUserQuotaDetail(row.userId)
      return updateUserQuota(row.userId, {
        policyId: detail.policyId,
        overrides: detail.overrides,
        enforcementPaused: !detail.enforcementPaused,
        note: detail.note,
      })
    },
    onSuccess: (_result, row) => {
      toast.success(row.enforcementPaused ? '已恢复限额' : '已暂停限额（用量仍会累计）')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '操作失败'),
  })

  const warnThreshold = config?.quotaWarnThreshold ?? 0.8
  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return users ?? []
    return (users ?? []).filter(
      (row) =>
        row.username.toLowerCase().includes(keyword) ||
        (row.displayName ?? '').toLowerCase().includes(keyword) ||
        (row.policyName ?? '').toLowerCase().includes(keyword),
    )
  }, [users, search])

  const allSelected =
    filteredUsers.length > 0 && filteredUsers.every((row) => selectedUserIds.includes(row.userId))

  /**
   * 切换单个用户的选中态。幂等：以「当前状态」而不是渲染时的闭包为准判断，
   * 因此即便同一次交互触发两次（复选框自身 + 冒泡到整行）也不会把同一个 id 加两遍——
   * 后端会以「用户列表不能包含重复项」拒绝整批。
   */
  const toggleUser = (userId: string) =>
    setSelectedUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    )

  return (
    <div className="space-y-5">
      <PageHeader
        title="用户限额"
        description="用「策略模板 + 用户覆写」控制每个人的用量上限；关闭总开关后配置与计数保留，用户端不可见。"
      />

      {/* 总开关 + 周期口径：关闭时全站不做任何判定 */}
      <div className={clsx(cardSurface, 'p-4')}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-neutral-800 dark:text-neutral-100">启用用户限额</div>
            <div className="mt-0.5 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
              {config?.quotaEnabled
                ? '已启用：超出额度的请求会被拦截，用户能看到自己的额度进度。'
                : '未启用：不做任何限制，用户端完全看不到额度信息（策略与用量计数仍保留）。'}
            </div>
          </div>
          <Toggle
            checked={config?.quotaEnabled ?? false}
            disabled={!config || toggleQuota.isPending}
            ariaLabel="启用用户限额"
            onChange={(value) => toggleQuota.mutate(value)}
          />
        </div>

        {config?.quotaEnabled && (
          <div className="mt-4 grid gap-3 border-t border-neutral-100 pt-4 sm:grid-cols-3 dark:border-neutral-800">
            <Select
              label="周期边界时区"
              className="w-full"
              value={config.quotaTimezone}
              onChange={(event) => saveConfig.mutate({ quotaTimezone: event.target.value })}
              options={QUOTA_TIMEZONE_OPTIONS}
            />
            <Select
              label="每周起始日"
              className="w-full"
              value={config.quotaWeekStart}
              onChange={(event) =>
                saveConfig.mutate({
                  quotaWeekStart: event.target.value as 'mon' | 'sun',
                })
              }
              options={[
                { value: 'mon', label: '周一' },
                { value: 'sun', label: '周日' },
              ]}
            />
            <Select
              label="用户预警阈值"
              className="w-full"
              value={String(config.quotaWarnThreshold)}
              onChange={(event) =>
                saveConfig.mutate({ quotaWarnThreshold: Number(event.target.value) })
              }
              options={[
                { value: '0.7', label: '已用 70%' },
                { value: '0.8', label: '已用 80%' },
                { value: '0.9', label: '已用 90%' },
                { value: '0.95', label: '已用 95%' },
              ]}
            />
          </div>
        )}
      </div>

      {/* 视图切换 */}
      <div className="flex items-center gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
        {(
          [
            ['policies', '策略'],
            ['users', '用户'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition',
              view === value
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'policies' ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setEditingPolicy(null)}>
              <Plus className="h-4 w-4" /> 新建策略
            </Button>
          </div>
          {loadingPolicies ? (
            <div className="py-16 text-center">
              <Spinner className="h-6 w-6 text-neutral-400" />
            </div>
          ) : (policies ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 py-14 text-center text-sm text-neutral-500 dark:border-neutral-700">
              还没有任何策略。建议先建一个「默认用户」策略并设为默认。
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(policies ?? []).map((policy) => (
                <PolicyCard
                  key={policy.id}
                  policy={policy}
                  onEdit={() => setEditingPolicy(policy)}
                  onDuplicate={() => duplicate.mutate(policy.id)}
                  onSetDefault={() => makeDefault.mutate(policy.id)}
                  onDelete={async () => {
                    // 删掉唯一的默认策略后全站不再有默认策略，隐式跟随它的用户会当场变成无限额度。
                    const lastDefault = policy.isDefault && (policies ?? []).length === 1
                    const confirmed = await askConfirm({
                      title: `删除策略「${policy.name}」`,
                      description: lastDefault
                        ? `这是唯一的策略：删除后全站将没有默认策略，${policy.boundUserCount} 位未单独指派的用户都会变成无限额度。`
                        : policy.boundUserCount > 0
                          ? `${policy.boundUserCount} 位用户将回退到默认策略；用量记录不受影响。`
                          : '该策略暂无用户使用。',
                      confirmLabel: '删除',
                      tone: 'danger',
                    })
                    if (confirmed) removePolicy.mutate(policy.id)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索用户或策略"
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-sky-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <Button
              variant={batchMode ? 'primary' : 'secondary'}
              className="shrink-0"
              aria-pressed={batchMode}
              onClick={() => {
                setBatchMode((current) => !current)
                setSelectedUserIds([])
              }}
            >
              <ListChecks className="h-4 w-4" /> 批量管理
            </Button>
          </div>

          {loadingUsers ? (
            <div className="py-16 text-center">
              <Spinner className="h-6 w-6 text-neutral-400" />
            </div>
          ) : (
            <div
              className={clsx(cardSurface, 'divide-y divide-neutral-100 dark:divide-neutral-800')}
            >
              {filteredUsers.map((row) => {
                const badge = statusBadge(row, warnThreshold)
                const selected = selectedUserIds.includes(row.userId)
                return (
                  <div
                    key={row.userId}
                    role={batchMode ? 'checkbox' : undefined}
                    aria-checked={batchMode ? selected : undefined}
                    tabIndex={batchMode ? 0 : undefined}
                    onClick={batchMode ? () => toggleUser(row.userId) : undefined}
                    onKeyDown={
                      batchMode
                        ? (event) => {
                            // 整行可聚焦就必须能用键盘操作：空格/回车与点击同义。
                            if (event.key !== ' ' && event.key !== 'Enter') return
                            event.preventDefault()
                            toggleUser(row.userId)
                          }
                        : undefined
                    }
                    className={clsx(
                      'flex flex-wrap items-center gap-3 px-4 py-3 transition',
                      batchMode && 'cursor-pointer',
                      selected && 'bg-sky-50/60 dark:bg-sky-500/5',
                    )}
                  >
                    {batchMode && (
                      // 复选框自身已经会切换一次；阻止冒泡，避免整行再切换一次导致「点了没反应」。
                      <span onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected}
                          onChange={() => toggleUser(row.userId)}
                          ariaLabel={`选择 ${row.username}`}
                        />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                          {row.username}
                        </span>
                        {row.displayName && (
                          <span className="truncate text-xs text-neutral-400">
                            {row.displayName}
                          </span>
                        )}
                        <span
                          className={clsx(
                            'shrink-0 rounded px-1.5 py-px text-[10px] font-medium',
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-400 dark:text-neutral-500">
                        <span>
                          {row.policyName ?? '无策略'}
                          {row.usingDefaultPolicy && '（默认）'}
                        </span>
                        {row.overrideCount > 0 && <span>已覆写 {row.overrideCount} 项</span>}
                        <span>最近使用 {formatRelative(row.lastActiveAt)}</span>
                      </div>
                    </div>

                    {/* 关键规则进度：无限额度不画进度条 */}
                    <div className="w-full sm:w-44">
                      {row.highlight ? (
                        <>
                          <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                            <span className="truncate">
                              {formatQuotaAmount(row.highlight.metric, row.highlight.used)} /{' '}
                              {formatQuotaAmount(
                                row.highlight.metric,
                                row.highlight.effectiveLimit ?? 0,
                              )}
                            </span>
                            <span>{Math.round((row.highlight.percent ?? 0) * 100)}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                            <div
                              className={clsx(
                                'h-full rounded-full',
                                row.blocked
                                  ? 'bg-rose-500 dark:bg-rose-400'
                                  : (row.highlight.percent ?? 0) >= warnThreshold
                                    ? 'bg-amber-500 dark:bg-amber-400'
                                    : 'bg-sky-500 dark:bg-sky-400',
                              )}
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(2, Math.round((row.highlight.percent ?? 0) * 100)),
                                )}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                          <InfinityIcon className="h-3 w-3" /> 不限额度
                        </span>
                      )}
                    </div>

                    {!batchMode && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => togglePause.mutate(row)}
                          title={row.enforcementPaused ? '恢复限额' : '暂停限额'}
                          aria-label={row.enforcementPaused ? '恢复限额' : '暂停限额'}
                          className={clsx(
                            'rounded-lg p-1.5 transition',
                            row.enforcementPaused
                              ? 'text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10'
                              : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
                          )}
                        >
                          <PauseCircle className="h-4 w-4" />
                        </button>
                        <Button
                          variant="secondary"
                          className="px-2.5 py-1.5 text-xs"
                          onClick={() => setDialogUser(row)}
                        >
                          配置
                        </Button>
                        <Link
                          to={`/admin/users/${row.userId}`}
                          className="rounded-lg px-2 py-1.5 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        >
                          明细
                        </Link>
                      </div>
                    )}
                  </div>
                )
              })}
              {filteredUsers.length === 0 && (
                <div className="py-12 text-center text-sm text-neutral-400">没有匹配的用户</div>
              )}
            </div>
          )}

          {/* 批量操作条：与模型页同一套语言（不透明胶囊 + 单行） */}
          {batchMode && (
            <div className="sticky bottom-4 z-10 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 py-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedUserIds.length > 0 && !allSelected}
                onChange={(checked) =>
                  setSelectedUserIds(checked ? filteredUsers.map((row) => row.userId) : [])
                }
                ariaLabel="全选"
              />
              <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                已选 {selectedUserIds.length} / {filteredUsers.length}
              </span>
              <Select
                className="w-44"
                aria-label="批量指派策略"
                value={batchPolicyId}
                onChange={(event) => setBatchPolicyId(event.target.value)}
                options={[
                  { value: '', label: '跟随默认策略' },
                  ...(policies ?? []).map((policy) => ({ value: policy.id, label: policy.name })),
                ]}
              />
              <Button
                className="px-3 py-1.5 text-xs"
                loading={batchAssign.isPending}
                disabled={selectedUserIds.length === 0}
                onClick={() => batchAssign.mutate()}
              >
                应用策略
              </Button>
              <Button
                variant="ghost"
                className="px-3 py-1.5 text-xs"
                onClick={() => {
                  setBatchMode(false)
                  setSelectedUserIds([])
                }}
              >
                完成
              </Button>
            </div>
          )}
        </div>
      )}

      {editingPolicy !== undefined && (
        <QuotaPolicyEditor
          open
          policy={editingPolicy}
          onClose={() => setEditingPolicy(undefined)}
        />
      )}
      {dialogUser && (
        <UserQuotaDialog
          open
          userId={dialogUser.userId}
          username={dialogUser.username}
          policies={policies ?? []}
          onClose={() => setDialogUser(null)}
        />
      )}
    </div>
  )
}
