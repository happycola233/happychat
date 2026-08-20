import { useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { clsx } from 'clsx'
import { Search, ShieldCheck, TriangleAlert, UserRound, UsersRound } from 'lucide-react'
import type { AdminUserDTO } from '@shared/types/api'
import { Checkbox } from '../../components/ui/Checkbox'
import { AdminUserAvatar } from './AdminUserAvatar'
import {
  filterUserScopeUsers,
  groupUserScopeUsers,
  setUserScopeSelection,
} from './userScopeSelection'

export type UserScopeMode = 'all' | 'selected'

export interface UserScopePanelCopy {
  allCaption: string
  selectedCaption: string
  allSummary: (userCount: number) => string
  allDescription: string
  emptySelection: string
  selectionOverLimit: (limit: number, selectedCount: number) => string
}

interface Props {
  users: AdminUserDTO[]
  mode: UserScopeMode
  selected: ReadonlySet<string>
  onModeChange: (mode: UserScopeMode) => void
  onSelectionChange: (selected: Set<string>) => void
  currentUserId?: string
  selectionLimit: number
  copy: UserScopePanelCopy
  radioGroupLabel: string
  className?: string
}

const MODE_OPTIONS = [
  { value: 'all', label: '所有用户', icon: UsersRound },
  { value: 'selected', label: '指定用户', icon: UserRound },
] as const

/** 模型授权与公告推送共用的用户范围面板；业务组件只负责保存范围。 */
export function UserScopePanel({
  users,
  mode,
  selected,
  onModeChange,
  onSelectionChange,
  currentUserId,
  selectionLimit,
  copy,
  radioGroupLabel,
  className,
}: Props) {
  const [search, setSearch] = useState('')
  const [selectedModeInitialized, setSelectedModeInitialized] = useState(
    mode === 'selected' || selected.size > 0,
  )
  const groupLabelPrefix = useId()
  const modeRefs = useRef<Partial<Record<UserScopeMode, HTMLButtonElement>>>({})

  const visibleUsers = useMemo(() => filterUserScopeUsers(users, search), [search, users])
  const visibleGroups = useMemo(() => groupUserScopeUsers(visibleUsers), [visibleUsers])
  const visibleIds = visibleUsers.map((user) => user.id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((userId) => selected.has(userId))

  const chooseMode = (nextMode: UserScopeMode) => {
    // 第一次从“所有用户”收窄时预选现有账号，避免一个点击就把范围意外变成空集。
    if (nextMode === 'selected' && !selectedModeInitialized) {
      onSelectionChange(new Set(users.map((user) => user.id)))
      setSelectedModeInitialized(true)
    }
    onModeChange(nextMode)
  }

  const onModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const nextMode: UserScopeMode = mode === 'all' ? 'selected' : 'all'
    chooseMode(nextMode)
    modeRefs.current[nextMode]?.focus()
  }

  const toggleUsers = (userIds: string[], shouldSelect: boolean) => {
    onSelectionChange(setUserScopeSelection(selected, userIds, shouldSelect))
  }

  const previewUsers = users.slice(0, 5)
  const extraUserCount = users.length - previewUsers.length
  const emptySelection = mode === 'selected' && selected.size === 0
  const selectionOverLimit = mode === 'selected' && selected.size > selectionLimit

  return (
    <div className={clsx('flex min-h-0 flex-1 flex-col gap-3 overflow-hidden', className)}>
      <div className="shrink-0">
        <div
          role="radiogroup"
          aria-label={radioGroupLabel}
          className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/70"
        >
          {MODE_OPTIONS.map((option) => {
            const active = mode === option.value
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
                onClick={() => chooseMode(option.value)}
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
          {mode === 'all' ? copy.allCaption : copy.selectedCaption}
        </p>
      </div>

      {mode === 'all' ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 px-6 text-center dark:border-neutral-700/70">
          {users.length > 0 && (
            <div className="flex -space-x-2">
              {previewUsers.map((user) => (
                <AdminUserAvatar
                  key={user.id}
                  username={user.username}
                  displayName={user.displayName}
                  avatarUrl={user.avatarUrl}
                  className="h-8 w-8 text-[11px] ring-2 ring-white dark:ring-neutral-900"
                  fallbackClassName={
                    user.role === 'admin'
                      ? 'bg-violet-50 bg-gradient-to-br from-violet-100 to-violet-200/70 text-violet-700 dark:bg-violet-950 dark:from-violet-500/30 dark:to-violet-500/10 dark:text-violet-300'
                      : 'bg-sky-50 bg-gradient-to-br from-sky-100 to-sky-200/70 text-sky-700 dark:bg-sky-950 dark:from-sky-500/30 dark:to-sky-500/10 dark:text-sky-300'
                  }
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
            {copy.allSummary(users.length)}
          </p>
          <p className="mt-1 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
            {copy.allDescription}
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
              onClick={() => onSelectionChange(new Set())}
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
                  <section key={group.role} aria-labelledby={`${groupLabelPrefix}-${group.role}`}>
                    <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-neutral-100 bg-white/95 px-3 py-2 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/95">
                      <Checkbox
                        checked={allGroupSelected}
                        indeterminate={selectedVisibleCount > 0 && !allGroupSelected}
                        onChange={() => toggleUsers(groupIds, !allGroupSelected)}
                        ariaLabel={`${allGroupSelected ? '取消选择' : '选择'}当前${group.label}`}
                      />
                      <h4
                        id={`${groupLabelPrefix}-${group.role}`}
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
                            <Checkbox
                              checked={checked}
                              onChange={() => toggleUsers([user.id], !checked)}
                            />
                            <AdminUserAvatar
                              username={user.username}
                              displayName={user.displayName}
                              avatarUrl={user.avatarUrl}
                              className={clsx(
                                'h-7 w-7 text-[11px]',
                                user.disabled && 'opacity-50 saturate-50',
                              )}
                              fallbackClassName={
                                user.role === 'admin'
                                  ? 'bg-violet-50 bg-gradient-to-br from-violet-100 to-violet-200/70 text-violet-700 dark:bg-violet-950 dark:from-violet-500/30 dark:to-violet-500/10 dark:text-violet-300'
                                  : 'bg-sky-50 bg-gradient-to-br from-sky-100 to-sky-200/70 text-sky-700 dark:bg-sky-950 dark:from-sky-500/30 dark:to-sky-500/10 dark:text-sky-300'
                              }
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
                            {user.id === currentUserId && (
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
                  ? copy.emptySelection
                  : copy.selectionOverLimit(selectionLimit, selected.size)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
