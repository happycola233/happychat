import { LoadError } from '../../components/ui/LoadError'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ChevronDown, ListChecks, PauseCircle, Plus, SlidersHorizontal } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { pickTightestQuotaBucket, groupQuotaBucketsByRule } from '@shared/util/quota'
import type { AdminQuotaPolicyDTO, AdminUserQuotaDTO } from '@shared/types/api'
import type { AppConfigUpdateInput } from '@shared/schemas/app-config'
import {
  batchAssignQuotaPolicy,
  deleteQuotaPolicy,
  duplicateQuotaPolicy,
  getUserQuotaDetail,
  getUserStats,
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
import { SearchField } from '../../components/ui/SearchField'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { formatRelative } from '../../lib/format'
import { rangeToFilter } from '../../lib/dateRange'
import { resolveQuotaRulesRefetchInterval } from '../../lib/quotaRefetch'
import { QuotaPolicyCard } from './QuotaPolicyCard'
import { QuotaPolicyEditor } from './QuotaPolicyEditor'
import { UserQuotaBuckets } from './UserQuotaBuckets'
import { UserQuotaDialog } from './UserQuotaDialog'
import { AdminUserAvatar } from './AdminUserAvatar'
import { UserQuotaOverview } from './UserQuotaOverview'
import { QuotaNoticeSettings } from './QuotaNoticeSettings'
import { QUOTA_TIMEZONE_OPTIONS, quotaTimezoneLabel } from './userQuotaDisplay'
import {
  USER_QUOTA_STATUS_META,
  classifyUserQuotaStatus,
  countableQuotaBuckets,
  userMatchesQuotaOverviewFilter,
  userQuotaStatusBadge,
  type QuotaOverviewRangeKey,
  type UserQuotaOverviewFilter,
} from './quotaOverview'

type View = 'policies' | 'users'

/**
 * 用户限额管理页：策略模板与逐用户配置两个视图。
 *
 * 策略视图管理「模板」，用户视图管理「谁用哪个模板 + 个别覆写」，
 * 批量交互沿用模型页的语言（行首多选 + 底部悬浮条），降低学习成本。
 */
export default function QuotasPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<View>(
    searchParams.get('userId') || searchParams.get('view') === 'users' ? 'users' : 'policies',
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())
  const [userSort, setUserSort] = useState('attention')
  const [editingPolicy, setEditingPolicy] = useState<AdminQuotaPolicyDTO | null | undefined>(
    undefined,
  )
  const [batchMode, setBatchMode] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [batchPolicyId, setBatchPolicyId] = useState('')
  const [dialogUser, setDialogUser] = useState<AdminUserQuotaDTO | null>(null)
  const [search, setSearch] = useState('')
  const [overviewFilter, setOverviewFilter] = useState<UserQuotaOverviewFilter | null>(null)
  const [usageRange, setUsageRange] = useState<QuotaOverviewRangeKey>('7d')
  const [highlightUserId, setHighlightUserId] = useState<string | null>(null)

  const {
    data: config,
    isError: configError,
    refetch: refetchConfig,
  } = useQuery({ queryKey: ['admin', 'app-config'], queryFn: getAppConfig })
  const {
    data: policies,
    isLoading: loadingPolicies,
    isError: policiesError,
    refetch: refetchPolicies,
  } = useQuery({
    queryKey: ['admin', 'quota', 'policies'],
    queryFn: listQuotaPolicies,
  })
  const {
    data: users,
    isLoading: loadingUsers,
    isError: usersError,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['admin', 'quota', 'users'],
    queryFn: listUserQuotas,
    enabled: view === 'users',
    refetchInterval: (query) => {
      const rows = query.state.data
      if (!rows) return false
      return resolveQuotaRulesRefetchInterval(
        rows.flatMap((row) => row.rules),
        {
          warnThreshold: config?.quotaWarnThreshold ?? 0.8,
          refreshAllFixedBoundaries: true,
        },
      )
    },
  })
  // 用量排行必须用可比时间窗：无限额度用户的快照没有计量桶，不能拿额度 used 相加。
  const { data: userStats, isLoading: loadingUserStats } = useQuery({
    queryKey: ['admin', 'quota', 'user-stats', usageRange],
    queryFn: () => getUserStats({ ...rangeToFilter(usageRange), kind: 'chat' }),
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
  const quotaTimezone = config?.quotaTimezone ?? 'UTC'
  const timezoneLabel = quotaTimezoneLabel(quotaTimezone)
  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return (users ?? [])
      .filter((row) => {
        if (!userMatchesQuotaOverviewFilter(row, overviewFilter, warnThreshold)) return false
        if (!keyword) return true
        return (
          row.username.toLowerCase().includes(keyword) ||
          (row.displayName ?? '').toLowerCase().includes(keyword) ||
          (row.policyName ?? '').toLowerCase().includes(keyword)
        )
      })
      .sort((left, right) => {
        if (userSort === 'name') return left.username.localeCompare(right.username, 'zh-CN')
        if (userSort === 'recent') return (right.lastUsageAt ?? 0) - (left.lastUsageAt ?? 0)
        const priority = { exhausted: 0, warning: 1, paused: 2, ok: 3, unlimited: 4 }
        return (
          priority[classifyUserQuotaStatus(left, warnThreshold)] -
            priority[classifyUserQuotaStatus(right, warnThreshold)] ||
          left.username.localeCompare(right.username, 'zh-CN')
        )
      })
  }, [users, search, overviewFilter, warnThreshold, userSort])

  useEffect(() => {
    const row = users?.find((user) => user.userId === searchParams.get('userId'))
    if (!row) return
    setDialogUser(row)
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('userId')
        next.set('view', 'users')
        return next
      },
      { replace: true },
    )
  }, [users, searchParams, setSearchParams])

  useEffect(() => {
    if (!highlightUserId) return
    document
      .getElementById(`quota-user-${highlightUserId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = window.setTimeout(() => setHighlightUserId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [highlightUserId])

  const revealUser = (userId: string) => {
    const row = users?.find((user) => user.userId === userId)
    const keyword = search.trim().toLowerCase()
    if (
      row &&
      keyword &&
      !row.username.toLowerCase().includes(keyword) &&
      !(row.displayName ?? '').toLowerCase().includes(keyword) &&
      !(row.policyName ?? '').toLowerCase().includes(keyword)
    ) {
      setSearch('')
    }
    setOverviewFilter(null)
    setHighlightUserId(userId)
    setExpandedUsers((current) => new Set([...current, userId]))
  }

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
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader title="用户限额" description="设置额度策略，快速找到需要调整额度的用户。" />

      {configError && <LoadError hasData={Boolean(config)} onRetry={() => void refetchConfig()} />}
      {/* 总开关 + 周期口径：关闭时全站不做任何判定 */}
      <div className={clsx(cardSurface, 'p-4')}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                启用用户限额
              </div>
              <span
                className={clsx(
                  'rounded-md px-1.5 py-px text-[10px] font-medium',
                  config?.quotaEnabled
                    ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300'
                    : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
                )}
              >
                {config?.quotaEnabled ? '已启用' : '未启用'}
              </span>
            </div>
            {!config?.quotaEnabled && (
              <p className="mt-1 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
                当前不限制用量，已有策略与用量仍保留。
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              label="周期与提醒"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </IconButton>
            <Toggle
              checked={config?.quotaEnabled ?? false}
              disabled={!config || toggleQuota.isPending}
              ariaLabel="启用用户限额"
              onChange={(value) => toggleQuota.mutate(value)}
            />
          </div>
        </div>

        {config?.quotaEnabled && settingsOpen && (
          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="周期边界时区"
                disabled={saveConfig.isPending}
                className="w-full"
                value={config.quotaTimezone}
                onChange={(event) => saveConfig.mutate({ quotaTimezone: event.target.value })}
                options={QUOTA_TIMEZONE_OPTIONS}
              />
              <Select
                label="每周起始日"
                disabled={saveConfig.isPending}
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
                disabled={saveConfig.isPending}
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
            <p className="mt-2 text-[11px] leading-5 text-neutral-400 dark:text-neutral-500">
              切换即保存，影响全站自然日 / 周 / 月的周期边界。
            </p>
            <QuotaNoticeSettings config={config} />
          </div>
        )}
      </div>

      {/* 视图与当前主操作共用一行，避免短标签撑满整条背景、操作按钮另起一行。 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          label="限额视图"
          value={view}
          onChange={(next) => {
            setView(next)
            setSearchParams({ view: next }, { replace: true })
          }}
          options={[
            { value: 'policies', label: '策略', count: policies?.length ?? 0 },
            { value: 'users', label: '用户', count: users?.length },
          ]}
        />

        {view === 'policies' ? (
          <Button className="w-full sm:w-auto" onClick={() => setEditingPolicy(null)}>
            <Plus className="h-4 w-4" /> 新建策略
          </Button>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="搜索用户或策略"
              className="min-w-0 flex-1 sm:w-60"
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
        )}
      </div>

      {view === 'policies' ? (
        <div className="space-y-3">
          {policiesError && (
            <LoadError hasData={Boolean(policies)} onRetry={() => void refetchPolicies()} />
          )}
          {policiesError && !policies ? null : loadingPolicies ? (
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
                <QuotaPolicyCard
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
          {usersError && <LoadError hasData={Boolean(users)} onRetry={() => void refetchUsers()} />}
          {usersError && !users ? null : loadingUsers ? (
            <div className="py-16 text-center">
              <Spinner className="h-6 w-6 text-neutral-400" />
            </div>
          ) : (
            <>
              <UserQuotaOverview
                users={users ?? []}
                stats={userStats}
                statsLoading={loadingUserStats}
                rangeKey={usageRange}
                onRangeKeyChange={setUsageRange}
                warnThreshold={warnThreshold}
                filter={overviewFilter}
                onFilterChange={setOverviewFilter}
                onSelectUser={revealUser}
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-neutral-500">
                  显示 {filteredUsers.length} 位用户 · {timezoneLabel}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label="用户排列方式"
                    value={userSort}
                    onChange={(event) => setUserSort(event.target.value)}
                    options={[
                      { value: 'attention', label: '需关注优先' },
                      { value: 'recent', label: '最近使用优先' },
                      { value: 'name', label: '按用户名' },
                    ]}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpandedUsers(
                        expandedUsers.size
                          ? new Set()
                          : new Set(filteredUsers.map((user) => user.userId)),
                      )
                    }
                  >
                    {expandedUsers.size ? '收起全部额度' : '展开全部额度'}
                  </Button>
                  {(search || overviewFilter) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSearch('')
                        setOverviewFilter(null)
                      }}
                    >
                      清除筛选
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {filteredUsers.map((row) => {
                  const status = classifyUserQuotaStatus(row, warnThreshold)
                  const badge = userQuotaStatusBadge(status)
                  const selected = selectedUserIds.includes(row.userId)
                  const expanded = expandedUsers.has(row.userId)
                  const tightest = pickTightestQuotaBucket(countableQuotaBuckets(row.rules))
                  const percent =
                    tightest?.percent == null ? null : Math.round(tightest.percent * 100)
                  const ruleCount = groupQuotaBucketsByRule(row.rules).length
                  return (
                    <div
                      key={row.userId}
                      id={`quota-user-${row.userId}`}
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
                        cardSurface,
                        'scroll-mt-4 px-4 py-3 transition',
                        batchMode && 'cursor-pointer',
                        selected &&
                          'border-sky-200 bg-sky-50/60 ring-1 ring-sky-200/70 dark:border-sky-800 dark:bg-sky-500/5 dark:ring-sky-800/70',
                        highlightUserId === row.userId &&
                          'border-sky-300 ring-2 ring-sky-300/80 dark:border-sky-700 dark:ring-sky-700/80',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-3">
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
                        <AdminUserAvatar
                          username={row.username}
                          displayName={row.displayName}
                          avatarUrl={row.avatarUrl}
                          className="h-9 w-9 text-xs"
                          fallbackClassName={USER_QUOTA_STATUS_META[status].glyphClass}
                        />
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
                            <span>最近使用 {formatRelative(row.lastUsageAt)}</span>
                          </div>
                        </div>

                        {!batchMode && (
                          <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                            <button
                              type="button"
                              onClick={() => togglePause.mutate(row)}
                              disabled={
                                togglePause.isPending &&
                                togglePause.variables?.userId === row.userId
                              }
                              title={row.enforcementPaused ? '恢复限额' : '暂停限额'}
                              aria-label={row.enforcementPaused ? '恢复限额' : '暂停限额'}
                              className={clsx(
                                'flex h-8 w-8 items-center justify-center rounded-lg transition',
                                row.enforcementPaused
                                  ? 'text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10'
                                  : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
                              )}
                            >
                              <PauseCircle className="h-4 w-4" />
                            </button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setDialogUser(row)}
                            >
                              配置
                            </Button>
                            <Link
                              to={`/admin/users/${row.userId}`}
                              className="inline-flex min-h-8 items-center rounded-lg px-2 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                            >
                              明细
                            </Link>
                            <IconButton
                              label={expanded ? '收起额度' : '展开额度'}
                              aria-expanded={expanded}
                              aria-controls={`quota-rules-${row.userId}`}
                              onClick={() =>
                                setExpandedUsers((current) => {
                                  const next = new Set(current)
                                  if (next.has(row.userId)) next.delete(row.userId)
                                  else next.add(row.userId)
                                  return next
                                })
                              }
                            >
                              <ChevronDown
                                className={clsx(
                                  'h-4 w-4 transition-transform',
                                  expanded && 'rotate-180',
                                )}
                              />
                            </IconButton>
                          </div>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
                        <span className="shrink-0">{ruleCount} 条额度规则</span>
                        {percent != null && (
                          <>
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200/70 dark:bg-neutral-800">
                              <div
                                className={clsx(
                                  'h-full rounded-full',
                                  USER_QUOTA_STATUS_META[status].barClass,
                                )}
                                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                              />
                            </div>
                            <span className="shrink-0 tabular-nums">最高占用 {percent}%</span>
                          </>
                        )}
                      </div>
                      <div id={`quota-rules-${row.userId}`} hidden={!expanded}>
                        <UserQuotaBuckets
                          rules={row.rules}
                          warnThreshold={warnThreshold}
                          timezone={quotaTimezone}
                        />
                      </div>
                    </div>
                  )
                })}
                {filteredUsers.length === 0 && (
                  <EmptyState
                    title="没有匹配的用户"
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSearch('')
                          setOverviewFilter(null)
                        }}
                      >
                        清除筛选
                      </Button>
                    }
                  />
                )}
              </div>
            </>
          )}

          {/* 批量操作条：与模型页同一套语言（不透明胶囊 + 单行） */}
          {batchMode && (
            <div className="sticky bottom-4 z-10 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2 dark:bg-neutral-800">
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
