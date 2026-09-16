import { LoadError } from '../../components/ui/LoadError'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, KeyRound, Plus, ShieldAlert } from 'lucide-react'
import type { AdminSessionDTO, AdminUserDTO, InviteCodeDTO } from '@shared/types/api'
import * as adminApi from '../../api/admin'
import { useMe } from '../../hooks/useAuth'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { PageHeader } from '../../components/ui/PageHeader'
import { Spinner } from '../../components/ui/Spinner'
import { TextField } from '../../components/ui/TextField'
import { SearchField } from '../../components/ui/SearchField'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Toggle } from '../../components/ui/Toggle'
import {
  responsiveTableBody as tableBody,
  responsiveTable as tableEl,
  responsiveTableHead as tableHead,
  responsiveTableRow as tableRowHover,
  tableScroll,
  tableShell,
  responsiveTd as td,
  th,
  mobileCellLabel,
} from '../../components/ui/tableStyles'
import { formatDateTime } from '../../lib/format'
import { copyToClipboard } from '../../lib/clipboard'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { CopyIcon, DeleteIcon } from '../../chat/icons'

type Tab = 'users' | 'invites' | 'sessions'

const TABS: { key: Tab; label: string }[] = [
  { key: 'users', label: '用户' },
  { key: 'invites', label: '邀请码' },
  { key: 'sessions', label: '会话' },
]

const fmtDate = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—')
const textActionClass =
  'inline-flex min-h-8 items-center justify-center rounded-lg px-2 text-xs font-medium transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 dark:hover:bg-neutral-800'

function LoadingBlock() {
  return (
    <div className="py-16 text-center">
      <Spinner className="h-6 w-6 text-neutral-400" />
    </div>
  )
}

export default function AuthCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentTab = searchParams.get('tab')
  const tab: Tab = currentTab === 'invites' || currentTab === 'sessions' ? currentTab : 'users'

  return (
    <div className="space-y-5">
      <PageHeader title="账号中心" description="管理用户、邀请码与登录会话。" />

      <SegmentedControl
        label="账号中心子页"
        value={tab}
        onChange={(next) => setSearchParams({ tab: next }, { replace: true })}
        options={TABS.map((item) => ({ value: item.key, label: item.label }))}
      />

      {tab === 'users' && <UsersTab />}
      {tab === 'invites' && <InvitesTab />}
      {tab === 'sessions' && <SessionsTab />}
    </div>
  )
}

// ===================== 用户 =====================

function UsersTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const { data: me } = useMe()
  const [passwordReset, setPasswordReset] = useState<{
    username: string
    temporaryPassword: string
  } | null>(null)
  const {
    data: users,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: adminApi.listUsers,
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] })

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminApi.updateUser>[1] }) =>
      adminApi.updateUser(id, input),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })
  const remove = useMutation({
    mutationFn: adminApi.deleteUser,
    onSuccess: () => {
      toast.success('已删除')
      // 用户删除会级联移除模型授权；同步刷新名单缓存和模型页人数，
      // 避免稍后打开权限面板时短暂看到已删除账号的旧数据。
      void Promise.all([
        invalidate(),
        qc.invalidateQueries({ queryKey: ['admin', 'model-access-editor'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'models'] }),
      ])
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })
  const resetPassword = useMutation({
    mutationFn: ({ id }: { id: string; username: string }) => adminApi.resetUserPassword(id),
    onSuccess: (result, target) => {
      setPasswordReset({ username: target.username, temporaryPassword: result.temporaryPassword })
      toast.success('密码已重置')
      void Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['admin', 'sessions'] })])
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '重置失败'),
  })

  const keyword = search.trim().toLowerCase()
  const filtered = (users ?? []).filter(
    (user) =>
      `${user.username} ${user.displayName ?? ''}`.toLowerCase().includes(keyword) &&
      (filter === 'all' ||
        (filter === 'admin'
          ? user.role === 'admin'
          : filter === 'disabled'
            ? user.disabled
            : !user.disabled)),
  )

  if (isLoading) return <LoadingBlock />
  if (isError) return <LoadError onRetry={() => void refetch()} />

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="搜索用户名或昵称"
          className="min-w-48 flex-1"
        />
        <SegmentedControl
          label="用户筛选"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: '全部', count: users?.length ?? 0 },
            { value: 'enabled', label: '已启用' },
            { value: 'admin', label: '管理员' },
            { value: 'disabled', label: '已停用' },
          ]}
        />
      </div>
      {filtered.length === 0 && (
        <EmptyState
          title="没有匹配的用户"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('')
                setFilter('all')
              }}
            >
              清除筛选
            </Button>
          }
        />
      )}
      <div className={tableScroll}>
        <div className={tableShell}>
          <table className={tableEl}>
            <thead className={tableHead}>
              <tr>
                <th className={th}>用户名</th>
                <th className={th}>管理员</th>
                <th className={th}>启用</th>
                <th className={th}>允许分享</th>
                <th className={th}>会话</th>
                <th className={th}>注册</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className={tableBody}>
              {filtered.map((u: AdminUserDTO) => {
                const isSelf = u.id === me?.id
                return (
                  <tr key={u.id} className={tableRowHover}>
                    <td className={clsx(td, 'col-span-2 text-neutral-800 dark:text-neutral-100')}>
                      <Link
                        to={`/admin/users/${u.id}`}
                        className="font-medium hover:text-sky-600 dark:hover:text-sky-400"
                      >
                        {u.username}
                      </Link>
                      {u.displayName && (
                        <span className="ml-2 text-xs text-neutral-500">{u.displayName}</span>
                      )}
                      {isSelf && <span className="ml-1 text-xs text-neutral-400">（你）</span>}
                      {u.mustChangePassword && (
                        <span className="ml-2 inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          待设置新密码
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      <span className={mobileCellLabel}>管理员权限</span>
                      <Toggle
                        ariaLabel={`管理员权限 ${u.username}`}
                        checked={u.role === 'admin'}
                        disabled={isSelf || update.isPending}
                        onChange={(v) =>
                          update.mutate({ id: u.id, input: { role: v ? 'admin' : 'user' } })
                        }
                      />
                    </td>
                    <td className={td}>
                      <span className={mobileCellLabel}>启用账号</span>
                      <Toggle
                        ariaLabel={`启用账号 ${u.username}`}
                        checked={!u.disabled}
                        disabled={isSelf || update.isPending}
                        onChange={(v) => update.mutate({ id: u.id, input: { disabled: !v } })}
                      />
                    </td>
                    <td className={td}>
                      <span className={mobileCellLabel}>允许分享</span>
                      <Toggle
                        ariaLabel={`允许分享 ${u.username}`}
                        checked={u.canShare !== false}
                        disabled={update.isPending}
                        onChange={(v) =>
                          update.mutate({ id: u.id, input: { canShare: v ? null : false } })
                        }
                      />
                    </td>
                    <td className={clsx(td, 'text-neutral-500')}>
                      <span className={mobileCellLabel}>会话数</span>
                      {u.conversationCount}
                    </td>
                    <td className={clsx(td, 'text-xs text-neutral-500')}>
                      <span className={mobileCellLabel}>注册时间</span>
                      {fmtDate(u.createdAt)}
                    </td>
                    <td className={clsx(td, 'col-span-2 text-right')}>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Link
                          to={`/admin/quotas?userId=${encodeURIComponent(u.id)}`}
                          className={`${textActionClass} text-neutral-600 dark:text-neutral-300`}
                        >
                          额度
                        </Link>
                        <button
                          type="button"
                          disabled={isSelf || resetPassword.isPending}
                          onClick={() => {
                            if (isSelf) return
                            void askConfirm({
                              title: '重置用户密码？',
                              description: `用户「${u.username}」的旧密码会立即失效，所有登录设备将被踢下线。系统会生成一个仅显示一次的临时密码。`,
                              confirmLabel: '重置密码',
                            }).then((ok) => {
                              if (ok) resetPassword.mutate({ id: u.id, username: u.username })
                            })
                          }}
                          className={clsx(
                            textActionClass,
                            isSelf
                              ? 'cursor-not-allowed text-neutral-300 no-underline dark:text-neutral-700'
                              : 'text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200',
                          )}
                          title={isSelf ? '请在个人设置中修改自己的密码' : '重置用户密码'}
                        >
                          重置密码
                        </button>
                        <Link
                          to={'/admin/users/' + u.id}
                          className={clsx(
                            textActionClass,
                            'text-neutral-600 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white',
                          )}
                        >
                          查看使用
                        </Link>
                        <button
                          type="button"
                          disabled={isSelf || update.isPending}
                          onClick={() => {
                            if (isSelf) return
                            void askConfirm({
                              title: '删除用户？',
                              description: `用户「${u.username}」及其全部会话、记录将被永久删除，且无法恢复。`,
                              confirmLabel: '删除',
                              tone: 'danger',
                            }).then((ok) => {
                              if (ok) remove.mutate(u.id)
                            })
                          }}
                          className={clsx(
                            'inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition',
                            isSelf
                              ? 'cursor-not-allowed opacity-35'
                              : 'hover:text-red-500 focus-visible:text-red-500',
                          )}
                          aria-label={isSelf ? '不能删除当前用户' : '删除'}
                          title={isSelf ? '不能删除当前用户' : '删除用户'}
                        >
                          <DeleteIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {passwordReset && (
        <TemporaryPasswordModal
          username={passwordReset.username}
          temporaryPassword={passwordReset.temporaryPassword}
          onClose={() => setPasswordReset(null)}
        />
      )}
    </>
  )
}

function TemporaryPasswordModal({
  username,
  temporaryPassword,
  onClose,
}: {
  username: string
  temporaryPassword: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copyPassword = () => {
    void copyToClipboard(temporaryPassword).then((ok) => {
      if (!ok) {
        toast.error('复制失败，请手动复制')
        return
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="临时密码已生成"
      footer={<Button onClick={onClose}>我已保存，关闭</Button>}
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <ShieldAlert className="mt-1 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            此密码只显示一次。关闭后无法再次查看；用户登录后必须立即设置新密码，才能进入聊天界面。
          </p>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            用户名
          </div>
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {username}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            临时密码
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/70">
            <KeyRound className="h-4 w-4 shrink-0 text-neutral-400" />
            <code className="min-w-0 flex-1 select-all break-all font-mono text-[15px] font-semibold tracking-wide text-neutral-900 dark:text-neutral-100">
              {temporaryPassword}
            </code>
            <Button variant="secondary" className="shrink-0 !px-3 !py-1.5" onClick={copyPassword}>
              {copied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <CopyIcon className="h-4 w-4" />
              )}
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ===================== 邀请码 =====================

function InvitesTab() {
  const qc = useQueryClient()
  const {
    data: invites,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'invites'],
    queryFn: adminApi.listInvites,
  })
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const isAvailable = (invite: InviteCodeDTO) =>
    !invite.disabled &&
    invite.usedCount < invite.maxUses &&
    (invite.expiresAt == null || invite.expiresAt > Date.now())
  const filtered = (invites ?? []).filter(
    (invite) =>
      `${invite.code} ${invite.note ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter === 'all' || isAvailable(invite) === (filter === 'active')),
  )
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'invites'] })

  const toggle = useMutation({ mutationFn: adminApi.toggleInvite, onSuccess: invalidate })
  const remove = useMutation({
    mutationFn: adminApi.deleteInvite,
    onSuccess: () => {
      toast.success('已删除')
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  const copy = (code: string) => {
    void copyToClipboard(code).then((ok) => {
      if (!ok) {
        toast.error('复制失败')
        return
      }
      setCopied(code)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          可在
          <Link
            to="/admin/settings"
            className="mx-1 font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-4 transition hover:text-neutral-950 dark:text-neutral-300 dark:decoration-neutral-600 dark:hover:text-white"
          >
            系统设置
          </Link>
          配置新用户注册是否需要邀请码。
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> 生成邀请码
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="搜索邀请码或备注"
          className="min-w-48 flex-1"
        />
        <SegmentedControl
          label="邀请码筛选"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: '全部', count: invites?.length ?? 0 },
            { value: 'active', label: '可使用' },
            { value: 'unavailable', label: '不可使用' },
          ]}
        />
      </div>
      {!isLoading && Boolean(invites?.length) && !filtered.length && (
        <EmptyState title="没有匹配的邀请码" />
      )}
      {isError ? (
        <LoadError onRetry={() => void refetch()} />
      ) : isLoading ? (
        <LoadingBlock />
      ) : !invites?.length ? (
        <EmptyState title="还没有邀请码" />
      ) : (
        <div className={tableScroll}>
          <div className={tableShell}>
            <table className={tableEl}>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>邀请码</th>
                  <th className={th}>用量</th>
                  <th className={th}>过期</th>
                  <th className={th}>状态</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className={tableBody}>
                {filtered.map((iv: InviteCodeDTO) => (
                  <tr key={iv.id} className={tableRowHover}>
                    <td className={`${td} col-span-2`}>
                      <button
                        onClick={() => copy(iv.code)}
                        className="flex items-center gap-1.5 font-mono text-neutral-800 dark:text-neutral-100"
                        title="复制"
                      >
                        {iv.code}
                        {copied === iv.code ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <CopyIcon className="h-3.5 w-3.5 text-neutral-400" />
                        )}
                      </button>
                      {iv.note && <div className="text-xs text-neutral-400">{iv.note}</div>}
                    </td>
                    <td className={clsx(td, 'text-neutral-500')}>
                      <span className={mobileCellLabel}>使用次数</span>
                      {iv.usedCount}/{iv.maxUses}
                    </td>
                    <td className={clsx(td, 'text-xs text-neutral-500')}>
                      <span className={mobileCellLabel}>过期时间</span>
                      {iv.expiresAt ? formatDateTime(iv.expiresAt) : '永久'}
                    </td>
                    <td className={td}>
                      <span className={mobileCellLabel}>状态</span>
                      <button
                        disabled={toggle.isPending}
                        title={iv.disabled ? '启用邀请码' : '停用邀请码'}
                        onClick={() => toggle.mutate(iv.id)}
                        className={
                          !isAvailable(iv)
                            ? 'min-h-8 rounded-md bg-neutral-100 px-2 text-xs text-neutral-500 dark:bg-neutral-800'
                            : 'min-h-8 rounded-md bg-emerald-50 px-2 text-xs text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                        }
                      >
                        {iv.disabled
                          ? '已停用'
                          : iv.expiresAt != null && iv.expiresAt <= Date.now()
                            ? '已过期'
                            : iv.usedCount >= iv.maxUses
                              ? '已用完'
                              : '可使用'}
                      </button>
                    </td>
                    <td className={clsx(td, 'text-right')}>
                      <button
                        onClick={() => remove.mutate(iv.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                        aria-label="删除"
                      >
                        <DeleteIcon className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && <CreateInviteModal onClose={() => setCreating(false)} onDone={invalidate} />}
    </div>
  )
}

function CreateInviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresInDays, setExpiresInDays] = useState('')

  const create = useMutation({
    mutationFn: () =>
      adminApi.createInvite({
        note: note.trim() || undefined,
        maxUses: Math.max(1, Number(maxUses) || 1),
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      }),
    onSuccess: (r) => {
      toast.success(`已生成邀请码：${r.code}`)
      onDone()
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '生成失败'),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="生成邀请码"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            生成
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如：给朋友 A"
        />
        <TextField
          label="可使用次数"
          type="number"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
        />
        <TextField
          label="有效天数（可选，留空永久）"
          type="number"
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(e.target.value)}
          placeholder="例如：7"
        />
      </div>
    </Modal>
  )
}

// ===================== 会话 =====================

function SessionIpCell({ session }: { session: AdminSessionDTO }) {
  const ipClass = 'break-all font-mono text-[11px] text-neutral-700 dark:text-neutral-200'
  const labelClass = 'whitespace-nowrap text-[11px] text-neutral-400 dark:text-neutral-500'

  if (!session.loginIp && !session.lastSeenIp) {
    return <span className="text-xs text-neutral-400 dark:text-neutral-500">未记录</span>
  }

  if (session.loginIp && session.loginIp === session.lastSeenIp) {
    return (
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2">
        <span className={labelClass}>登录 / 最近</span>
        <span className={ipClass}>{session.loginIp}</span>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {(
        [
          ['登录', session.loginIp],
          ['最近', session.lastSeenIp],
        ] as const
      ).map(([label, ip]) => (
        <div key={label} className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-2">
          <span className={labelClass}>{label}</span>
          <span className={ip ? ipClass : labelClass}>{ip ?? '未记录'}</span>
        </div>
      ))}
    </div>
  )
}

function SessionsTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const {
    data: sessions,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'sessions'],
    queryFn: () => adminApi.getSessions(),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'sessions'] })

  const revoke = useMutation({
    mutationFn: adminApi.revokeSession,
    onSuccess: () => {
      toast.success('已踢下线')
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  const filtered = (sessions ?? []).filter((session) =>
    `${session.username} ${session.userAgent ?? ''} ${session.loginIp ?? ''} ${session.lastSeenIp ?? ''}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  )

  if (isLoading) return <LoadingBlock />
  if (isError) return <LoadError onRetry={() => void refetch()} />

  if (!sessions?.length) return <EmptyState title="暂无活动会话" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="搜索用户、设备或 IP"
          className="min-w-48 flex-1"
        />
        <span className="text-xs text-neutral-500">{filtered.length} 个登录会话</span>
      </div>
      {!filtered.length && <EmptyState title="没有匹配的登录会话" />}
      <div className={tableScroll}>
        <div className={tableShell}>
          <table className={tableEl}>
            <thead className={tableHead}>
              <tr>
                <th className={th}>用户</th>
                <th className={th}>设备</th>
                <th className={th}>IP</th>
                <th className={th}>登录时间</th>
                <th className={th}>过期</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className={tableBody}>
              {filtered.map((s: AdminSessionDTO) => (
                <tr key={s.id} className={tableRowHover}>
                  <td className={clsx(td, 'col-span-2 text-neutral-800 dark:text-neutral-100')}>
                    <Link
                      to={`/admin/users/${s.userId}`}
                      className="font-medium hover:text-sky-600"
                    >
                      {s.username}
                    </Link>
                  </td>
                  <td
                    className={clsx(
                      td,
                      'col-span-2 truncate text-xs text-neutral-500 lg:max-w-[20rem]',
                    )}
                  >
                    <span className={mobileCellLabel}>设备</span>
                    {s.userAgent ?? '—'}
                  </td>
                  <td className={clsx(td, 'col-span-2 lg:min-w-[15rem] lg:max-w-[22rem]')}>
                    <span className={mobileCellLabel}>IP</span>
                    <SessionIpCell session={s} />
                  </td>
                  <td className={clsx(td, 'text-xs text-neutral-500')}>
                    <span className={mobileCellLabel}>登录时间</span>
                    {formatDateTime(s.createdAt)}
                  </td>
                  <td className={clsx(td, 'text-xs text-neutral-500')}>
                    <span className={mobileCellLabel}>过期时间</span>
                    {formatDateTime(s.expiresAt)}
                  </td>
                  <td className={clsx(td, 'col-span-2 text-right')}>
                    <button
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.id)}
                      className={clsx(
                        textActionClass,
                        'text-neutral-600 hover:text-red-500 dark:text-neutral-300 dark:hover:text-red-400',
                      )}
                    >
                      踢下线
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
