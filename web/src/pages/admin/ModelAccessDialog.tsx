import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Info, Search, ShieldCheck, TriangleAlert, UserRound, UsersRound } from 'lucide-react'
import { MODEL_ACCESS_USER_LIMIT } from '@shared/schemas/model-config'
import type { AdminModelDTO, AdminUserDTO, ModelAccessDTO } from '@shared/types/api'
import * as adminApi from '../../api/admin'
import { ApiRequestError } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { IndeterminateCheckbox } from '../../components/ui/IndeterminateCheckbox'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useMe } from '../../hooks/useAuth'
import { toast } from '../../store/toast'
import {
  filterModelAccessUsers,
  groupModelAccessUsers,
  keepExistingModelAccessUserIds,
  sameModelAccess,
  setModelAccessSelection,
} from './modelAccessSelection'

interface Props {
  model: AdminModelDTO
  onClose: () => void
}

function sameIds(left: ReadonlySet<string>, right: readonly string[]): boolean {
  return left.size === right.length && right.every((id) => left.has(id))
}

function userInitial(user: AdminUserDTO): string {
  return [...(user.displayName || user.username).trim()][0]?.toLocaleUpperCase('zh-CN') ?? '?'
}

/** 优先展示用户上传的头像；缺失或加载失败时回退为角色配色的姓名首字母。 */
function UserAvatar({ user, className }: { user: AdminUserDTO; className?: string }) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false)

  if (user.avatarUrl && !imageLoadFailed) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        aria-hidden
        draggable={false}
        onError={() => setImageLoadFailed(true)}
        className={clsx('shrink-0 rounded-full object-cover', className)}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        user.role === 'admin'
          ? 'bg-gradient-to-br from-violet-100 to-violet-200/70 text-violet-700 dark:from-violet-500/30 dark:to-violet-500/10 dark:text-violet-300'
          : 'bg-gradient-to-br from-sky-100 to-sky-200/70 text-sky-700 dark:from-sky-500/30 dark:to-sky-500/10 dark:text-sky-300',
        className,
      )}
    >
      {userInitial(user)}
    </span>
  )
}

interface ModelAccessSnapshot {
  access: ModelAccessDTO
  users: AdminUserDTO[]
  ignoredUserCount: number
}

/**
 * 用户先读、访问策略后读，尽量让级联删除后的名单天然一致；若期间恰好新增并授权了账号，
 * 再补读一次用户。最终仍按现存账号归一化，绝不把界面无法呈现的 ID 带回保存请求。
 */
async function loadModelAccessSnapshot(modelId: string): Promise<ModelAccessSnapshot> {
  let users = await adminApi.listUsers()
  const access = await adminApi.getModelAccess(modelId)
  let userIds = keepExistingModelAccessUserIds(access.userIds, users)
  if (userIds.length !== access.userIds.length) {
    users = await adminApi.listUsers()
    userIds = keepExistingModelAccessUserIds(access.userIds, users)
  }
  return {
    access: { accessMode: access.accessMode, userIds },
    users,
    ignoredUserCount: access.userIds.length - userIds.length,
  }
}

class ModelAccessChangedError extends Error {
  constructor() {
    super('模型访问范围已变化')
    this.name = 'ModelAccessChangedError'
  }
}

/**
 * 模型权限单独读取：管理列表只带人数，避免每个模型都重复传整份用户 ID 列表。
 * 面板打开后才加载用户与授权详情，关闭即丢弃未保存草稿。
 */
export function ModelAccessDialog({ model, onClose }: Props) {
  const snapshot = useQuery({
    // 独立、短生命周期的编辑快照：不能用账号页或上次打开留下的 30 秒缓存初始化权限草稿。
    queryKey: ['admin', 'model-access-editor', model.id],
    queryFn: () => loadModelAccessSnapshot(model.id),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    // 编辑器自己管理显式冲突恢复；窗口切换时不能悄悄替换正在编辑的基准快照。
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [draftVersion, setDraftVersion] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<unknown>(null)

  const refreshAndResetDraft = async (notice: string) => {
    setRecovering(true)
    setRefreshNotice(null)
    setRefreshError(null)
    const refreshed = await snapshot.refetch({ cancelRefetch: true })
    setRecovering(false)
    if (refreshed.data && !refreshed.error) {
      setDraftVersion((version) => version + 1)
      setRefreshNotice(notice)
      return
    }
    setRefreshError(refreshed.error ?? new Error('重新加载用户范围失败'))
  }

  // 即使 QueryClient 里碰巧还有数据，也必须等本次挂载的网络读取完成后才能创建 useState 草稿。
  if (snapshot.data && snapshot.isFetchedAfterMount && !recovering && !refreshError) {
    return (
      <ModelAccessEditor
        key={`${model.id}:${draftVersion}`}
        model={model}
        access={snapshot.data.access}
        users={snapshot.data.users}
        refreshNotice={
          refreshNotice ??
          (snapshot.data.ignoredUserCount > 0
            ? `已忽略 ${snapshot.data.ignoredUserCount} 个已删除账号，请重新确认范围。`
            : null)
        }
        onRefreshRequired={(notice) => void refreshAndResetDraft(notice)}
        onClose={onClose}
      />
    )
  }

  const error = refreshError ?? (snapshot.isFetchedAfterMount ? snapshot.error : null)
  return (
    <Modal open onClose={onClose} title={`可用范围 · ${model.displayName}`} size="form">
      {error ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-red-500">
            {error instanceof Error ? error.message : '加载用户范围失败'}
          </p>
          <Button
            variant="secondary"
            className="!px-3 !py-2"
            onClick={() => void refreshAndResetDraft('已重新加载最新的用户与授权范围。')}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <div className="flex min-h-52 items-center justify-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      )}
    </Modal>
  )
}

const MODE_OPTIONS = [
  {
    value: 'all',
    label: '所有用户',
    icon: UsersRound,
    caption: '所有账号都能使用此模型，之后新注册的账号也会自动获得权限。',
  },
  {
    value: 'selected',
    label: '指定用户',
    icon: UserRound,
    caption: '仅勾选的账号能使用此模型，新注册账号默认不可用。',
  },
] as const

function ModelAccessEditor({
  model,
  access: loadedAccess,
  users: loadedUsers,
  refreshNotice,
  onRefreshRequired,
  onClose,
}: Props & {
  access: ModelAccessDTO
  users: AdminUserDTO[]
  refreshNotice: string | null
  onRefreshRequired: (notice: string) => void
}) {
  const qc = useQueryClient()
  const { data: me } = useMe()
  // 编辑期间冻结用户与权限基准；只有显式恢复递增 key 后才用服务端新快照重建草稿。
  // 这样即使未来有人手动失效此查询，也不会把新 props 与旧选择混在一起并覆盖他人修改。
  const [baselineAccess] = useState<ModelAccessDTO>(() => ({
    accessMode: loadedAccess.accessMode,
    userIds: [...loadedAccess.userIds],
  }))
  const [users] = useState<AdminUserDTO[]>(() => [...loadedUsers])
  const [accessMode, setAccessMode] = useState(baselineAccess.accessMode)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(baselineAccess.userIds))
  // 从“所有用户”第一次切到“指定用户”时默认勾选现有账号，避免范围切换造成意外下架。
  const [selectedModeInitialized, setSelectedModeInitialized] = useState(
    baselineAccess.accessMode === 'selected',
  )
  const [search, setSearch] = useState('')
  const modeRefs = useRef<Partial<Record<ModelAccessDTO['accessMode'], HTMLButtonElement>>>({})

  const visibleUsers = useMemo(() => filterModelAccessUsers(users, search), [search, users])
  const visibleGroups = useMemo(() => groupModelAccessUsers(visibleUsers), [visibleUsers])
  const visibleIds = visibleUsers.map((user) => user.id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((userId) => selected.has(userId))

  const chooseAccessMode = (nextMode: ModelAccessDTO['accessMode']) => {
    if (nextMode === 'selected' && !selectedModeInitialized) {
      setSelected(new Set(users.map((user) => user.id)))
      setSelectedModeInitialized(true)
    }
    setAccessMode(nextMode)
  }

  // 分段控件按 radio 语义走漫游焦点：方向键在两个选项间切换并跟随聚焦。
  const onModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const nextMode = accessMode === 'all' ? 'selected' : 'all'
    chooseAccessMode(nextMode)
    modeRefs.current[nextMode]?.focus()
  }

  const toggleUser = (userId: string) => {
    setSelected((current) => setModelAccessSelection(current, [userId], !current.has(userId)))
  }

  const toggleUsers = (userIds: string[], shouldSelect: boolean) => {
    setSelected((current) => setModelAccessSelection(current, userIds, shouldSelect))
  }

  const dirty =
    accessMode !== baselineAccess.accessMode ||
    (accessMode === 'selected' && !sameIds(selected, baselineAccess.userIds))
  const emptySelection = accessMode === 'selected' && selected.size === 0
  const selectionOverLimit = accessMode === 'selected' && selected.size > MODEL_ACCESS_USER_LIMIT

  const save = useMutation({
    mutationFn: async () => {
      // 完整名单采用替换语义；保存前做一次轻量冲突检查，避免旧面板覆盖另一位管理员的新授权。
      // 后端目前没有版本化 CAS，这不能消除 GET→PUT 的极窄竞态，但能覆盖缓存与长时间编辑场景。
      const latestAccess = await adminApi.getModelAccess(model.id)
      if (!sameModelAccess(latestAccess, baselineAccess)) throw new ModelAccessChangedError()
      await adminApi.updateModelAccess(model.id, {
        accessMode,
        userIds: accessMode === 'selected' ? [...selected] : [],
      })
    },
    onSuccess: () => {
      toast.success('已保存可用范围')
      qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      // 当前管理员也可能刚被移出范围，用户端模型缓存必须立即按服务端重新过滤。
      qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
    onError: (error) => {
      if (error instanceof ModelAccessChangedError) {
        onRefreshRequired('授权范围已被其他操作更新；草稿未保存，已刷新为最新状态。')
        return
      }
      if (error instanceof ApiRequestError && error.code === 'unknown_users') {
        onRefreshRequired('有账号在编辑期间被删除；草稿未保存，已移除失效账号并刷新。')
        return
      }
      toast.error(error instanceof Error ? error.message : '保存可用范围失败')
    },
  })

  const previewUsers = users.slice(0, 5)
  const extraUserCount = users.length - previewUsers.length
  const activeCaption = MODE_OPTIONS.find((option) => option.value === accessMode)?.caption

  return (
    <Modal
      open
      onClose={save.isPending ? () => undefined : onClose}
      title={`可用范围 · ${model.displayName}`}
      size="form"
      footer={
        <>
          <span
            aria-live="polite"
            className="mr-auto min-w-0 self-center truncate text-xs tabular-nums text-neutral-400 dark:text-neutral-500"
          >
            {accessMode === 'all'
              ? `全部 ${users.length} 位用户可用`
              : `已选 ${selected.size} / ${users.length} 位用户`}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            取消
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!dirty || emptySelection || selectionOverLimit}
          >
            保存范围
          </Button>
        </>
      }
    >
      {/* Modal 自身只有 max-height，百分比高度无法成为列表的确定约束；用固定高度让两种模式等高不跳动，且仅名单滚动。 */}
      <div className="flex h-[min(62vh,32rem)] min-h-0 flex-col gap-3 overflow-hidden">
        {!model.enabled && (
          <p className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-700 dark:border-amber-500/20 dark:bg-amber-950/25 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            此模型目前已全局停用；这里保存的范围会在重新启用后生效。
          </p>
        )}
        {refreshNotice && (
          <p
            role="status"
            className="flex shrink-0 items-start gap-2 rounded-lg border border-sky-200/70 bg-sky-50/70 px-3 py-2 text-xs leading-5 text-sky-700 dark:border-sky-500/20 dark:bg-sky-950/30 dark:text-sky-300"
          >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {refreshNotice}
          </p>
        )}

        <div className="shrink-0">
          <div
            role="radiogroup"
            aria-label="模型可用范围模式"
            className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/70"
          >
            {MODE_OPTIONS.map((option) => {
              const active = accessMode === option.value
              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    modeRefs.current[option.value] = node ?? undefined
                  }}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => chooseAccessMode(option.value)}
                  onKeyDown={onModeKeyDown}
                  className={clsx(
                    'flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                    active
                      ? 'bg-white font-medium text-neutral-900 shadow-sm ring-1 ring-black/[0.04] dark:bg-neutral-700 dark:text-neutral-50 dark:ring-white/10'
                      : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
                  )}
                >
                  <option.icon className={clsx('h-4 w-4', active && 'text-sky-500')} />
                  {option.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 px-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {activeCaption}
          </p>
        </div>

        {accessMode === 'all' ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 px-6 text-center dark:border-neutral-700/70">
            {users.length > 0 && (
              <div className="flex -space-x-2">
                {previewUsers.map((user) => (
                  <UserAvatar
                    key={user.id}
                    user={user}
                    className="h-8 w-8 text-[11px] ring-2 ring-white dark:ring-neutral-900"
                  />
                ))}
                {extraUserCount > 0 && (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-medium text-neutral-500 ring-2 ring-white dark:bg-neutral-800 dark:text-neutral-400 dark:ring-neutral-900">
                    +{extraUserCount}
                  </span>
                )}
              </div>
            )}
            <p className="mt-3 text-sm font-medium text-neutral-800 dark:text-neutral-100">
              当前 {users.length} 位用户均可使用
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
              新注册的账号会自动获得使用权限，无需再次配置
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            <div className="flex shrink-0 items-center gap-1.5">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">搜索用户</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索显示名称或用户名"
                  className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-neutral-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-sky-400"
                />
              </label>
              <button
                type="button"
                disabled={visibleIds.length === 0}
                onClick={() => toggleUsers(visibleIds, !allVisibleSelected)}
                className="shrink-0 rounded-lg px-2.5 py-2 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                {allVisibleSelected ? '取消当前' : '全选当前'}
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
                className="shrink-0 rounded-lg px-2.5 py-2 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                清空
              </button>
            </div>

            <div
              className="hc-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 dark:border-neutral-800"
              aria-label="用户列表"
            >
              {visibleUsers.length === 0 ? (
                <div className="flex min-h-36 flex-col items-center justify-center px-4 text-center">
                  <p className="text-sm text-neutral-400">没有匹配的用户</p>
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="mt-2 rounded-lg px-2 py-1 text-xs text-sky-600 transition hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                    >
                      清除搜索
                    </button>
                  )}
                </div>
              ) : (
                visibleGroups.map((group) => {
                  if (group.users.length === 0) return null
                  const groupIds = group.users.map((user) => user.id)
                  const selectedVisibleCount = groupIds.filter((id) => selected.has(id)).length
                  const allGroupSelected = selectedVisibleCount === groupIds.length
                  const totalGroupUsers = users.filter((user) => user.role === group.role)
                  const totalGroupSelected = totalGroupUsers.filter((user) =>
                    selected.has(user.id),
                  ).length
                  return (
                    <section key={group.role} aria-labelledby={`model-access-${group.role}`}>
                      <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-neutral-100 bg-white/95 px-3 py-2 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/95">
                        <IndeterminateCheckbox
                          checked={allGroupSelected}
                          indeterminate={selectedVisibleCount > 0 && !allGroupSelected}
                          onChange={() => toggleUsers(groupIds, !allGroupSelected)}
                          ariaLabel={`${allGroupSelected ? '取消选择' : '选择'}当前${group.label}`}
                        />
                        <h4
                          id={`model-access-${group.role}`}
                          className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300"
                        >
                          {group.role === 'admin' ? (
                            <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
                          ) : (
                            <UsersRound className="h-3.5 w-3.5 text-sky-400" />
                          )}
                          {group.label}
                        </h4>
                        <span className="ml-auto text-[11px] tabular-nums text-neutral-400">
                          {totalGroupSelected} / {totalGroupUsers.length}
                        </span>
                      </div>
                      <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                        {group.users.map((user) => {
                          const checked = selected.has(user.id)
                          return (
                            <label
                              key={user.id}
                              className={clsx(
                                'flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors',
                                checked
                                  ? 'bg-sky-50/60 hover:bg-sky-50 dark:bg-sky-500/[0.08] dark:hover:bg-sky-500/[0.12]'
                                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                              )}
                            >
                              <IndeterminateCheckbox
                                checked={checked}
                                onChange={() => toggleUser(user.id)}
                              />
                              <UserAvatar
                                user={user}
                                className={clsx(
                                  'h-7 w-7 text-[11px]',
                                  user.disabled && 'opacity-50 saturate-50',
                                )}
                              />
                              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                                <span
                                  className={clsx(
                                    'truncate text-sm',
                                    user.disabled
                                      ? 'text-neutral-400 dark:text-neutral-500'
                                      : checked
                                        ? 'font-medium text-neutral-900 dark:text-neutral-50'
                                        : 'text-neutral-700 dark:text-neutral-200',
                                  )}
                                >
                                  {user.displayName || user.username}
                                </span>
                                {user.displayName && (
                                  <span className="hidden truncate text-xs text-neutral-400 sm:block dark:text-neutral-500">
                                    @{user.username}
                                  </span>
                                )}
                              </span>
                              {user.id === me?.id && (
                                <span className="shrink-0 rounded-full bg-sky-100/90 px-2 py-px text-[10px] leading-4 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
                                  你
                                </span>
                              )}
                              {user.disabled && (
                                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-px text-[10px] leading-4 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                                  已停用
                                </span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </section>
                  )
                })
              )}
            </div>

            <div aria-live="polite" className="shrink-0 empty:hidden">
              {(emptySelection || selectionOverLimit) && (
                <p className="flex items-start gap-1.5 text-xs leading-5 text-amber-600 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {emptySelection
                    ? '请至少选择 1 位用户；若要对所有人下架，请使用模型列表开关。'
                    : `最多选择 ${MODEL_ACCESS_USER_LIMIT.toLocaleString('zh-CN')} 位用户；当前已选 ${selected.size.toLocaleString('zh-CN')} 位。`}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
