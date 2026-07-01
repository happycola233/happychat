import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import type { AdminSessionDTO, AdminUserDTO, InviteCodeDTO } from '@shared/types/api'
import * as adminApi from '../../api/admin'
import { useMe } from '../../hooks/useAuth'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { TextField } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import {
  tableBody,
  tableEl,
  tableHead,
  tableRowHover,
  tableScroll,
  tableShell,
  td,
  th,
} from '../../components/ui/tableStyles'
import { formatDateTime } from '../../lib/format'
import { copyToClipboard } from '../../lib/clipboard'
import { toast } from '../../store/toast'

type Tab = 'users' | 'invites' | 'sessions'

const TABS: { key: Tab; label: string }[] = [
  { key: 'users', label: '用户' },
  { key: 'invites', label: '邀请码' },
  { key: 'sessions', label: '会话' },
]

const fmtDate = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—')
const textActionClass =
  'rounded px-1 py-0.5 text-xs font-medium underline underline-offset-4 decoration-neutral-300 transition hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15 dark:decoration-neutral-600 dark:focus-visible:ring-white/20'

function LoadingBlock() {
  return (
    <div className="py-16 text-center">
      <Spinner className="h-6 w-6 text-neutral-400" />
    </div>
  )
}

export default function AuthCenterPage() {
  const [tab, setTab] = useState<Tab>('users')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">账号中心</h1>
        <div className="inline-flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={clsx(
                'rounded-md px-3 py-1 text-[13px] font-medium transition',
                tab === t.key
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'invites' && <InvitesTab />}
      {tab === 'sessions' && <SessionsTab />}
    </div>
  )
}

// ===================== 用户 =====================

function UsersTab() {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const { data: users, isLoading } = useQuery({
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
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  if (isLoading) return <LoadingBlock />

  return (
    <div className={tableScroll}>
      <div className={`${tableShell} min-w-[720px]`}>
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
            {users?.map((u: AdminUserDTO) => {
              const isSelf = u.id === me?.id
              return (
                <tr key={u.id} className={tableRowHover}>
                  <td className={clsx(td, 'text-neutral-800 dark:text-neutral-100')}>
                    {u.username}
                    {isSelf && <span className="ml-1 text-xs text-neutral-400">（你）</span>}
                  </td>
                  <td className={td}>
                    <Toggle
                      checked={u.role === 'admin'}
                      disabled={isSelf}
                      onChange={(v) =>
                        update.mutate({ id: u.id, input: { role: v ? 'admin' : 'user' } })
                      }
                    />
                  </td>
                  <td className={td}>
                    <Toggle
                      checked={!u.disabled}
                      disabled={isSelf}
                      onChange={(v) => update.mutate({ id: u.id, input: { disabled: !v } })}
                    />
                  </td>
                  <td className={td}>
                    <Toggle
                      checked={u.canShare !== false}
                      onChange={(v) =>
                        update.mutate({ id: u.id, input: { canShare: v ? null : false } })
                      }
                    />
                  </td>
                  <td className={clsx(td, 'text-neutral-500')}>{u.conversationCount}</td>
                  <td className={clsx(td, 'text-xs text-neutral-500')}>{fmtDate(u.createdAt)}</td>
                  <td className={clsx(td, 'text-right')}>
                    <div className="flex items-center justify-end gap-3">
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
                        disabled={isSelf}
                        onClick={() => {
                          if (isSelf) return
                          if (confirm(`确定删除用户「${u.username}」？其会话与记录将一并删除。`))
                            remove.mutate(u.id)
                        }}
                        className={clsx(
                          'text-neutral-400 transition',
                          isSelf
                            ? 'cursor-not-allowed opacity-35'
                            : 'hover:text-red-500 focus-visible:text-red-500',
                        )}
                        aria-label={isSelf ? '不能删除当前用户' : '删除'}
                        title={isSelf ? '不能删除当前用户' : '删除用户'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
  )
}

// ===================== 邀请码 =====================

function InvitesTab() {
  const qc = useQueryClient()
  const { data: invites, isLoading } = useQuery({
    queryKey: ['admin', 'invites'],
    queryFn: adminApi.listInvites,
  })
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
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
        <p className="text-sm text-neutral-500">注册需要有效邀请码（首位用户除外）</p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> 生成邀请码
        </Button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : !invites?.length ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          还没有邀请码
        </div>
      ) : (
        <div className={tableScroll}>
          <div className={`${tableShell} min-w-[560px]`}>
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
                {invites.map((iv: InviteCodeDTO) => (
                  <tr key={iv.id} className={tableRowHover}>
                    <td className={td}>
                      <button
                        onClick={() => copy(iv.code)}
                        className="flex items-center gap-1.5 font-mono text-neutral-800 dark:text-neutral-100"
                        title="复制"
                      >
                        {iv.code}
                        {copied === iv.code ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-neutral-400" />
                        )}
                      </button>
                      {iv.note && <div className="text-xs text-neutral-400">{iv.note}</div>}
                    </td>
                    <td className={clsx(td, 'text-neutral-500')}>
                      {iv.usedCount}/{iv.maxUses}
                    </td>
                    <td className={clsx(td, 'text-xs text-neutral-500')}>
                      {iv.expiresAt ? formatDateTime(iv.expiresAt) : '永久'}
                    </td>
                    <td className={td}>
                      <button
                        onClick={() => toggle.mutate(iv.id)}
                        className={
                          iv.disabled
                            ? 'rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800'
                            : 'rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                        }
                      >
                        {iv.disabled ? '已停用' : '启用中'}
                      </button>
                    </td>
                    <td className={clsx(td, 'text-right')}>
                      <button
                        onClick={() => remove.mutate(iv.id)}
                        className="text-neutral-400 hover:text-red-500"
                        aria-label="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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

function SessionsTab() {
  const qc = useQueryClient()
  const { data: sessions, isLoading } = useQuery({
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

  if (isLoading) return <LoadingBlock />

  if (!sessions?.length)
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
        暂无活动会话
      </div>
    )

  return (
    <div className={tableScroll}>
      <div className={`${tableShell} min-w-[720px]`}>
        <table className={tableEl}>
          <thead className={tableHead}>
            <tr>
              <th className={th}>用户</th>
              <th className={th}>设备</th>
              <th className={th}>登录时间</th>
              <th className={th}>过期</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className={tableBody}>
            {sessions.map((s: AdminSessionDTO) => (
              <tr key={s.id} className={tableRowHover}>
                <td className={clsx(td, 'text-neutral-800 dark:text-neutral-100')}>{s.username}</td>
                <td className={clsx(td, 'max-w-[20rem] truncate text-xs text-neutral-500')}>
                  {s.userAgent ?? '—'}
                </td>
                <td className={clsx(td, 'text-xs text-neutral-500')}>
                  {formatDateTime(s.createdAt)}
                </td>
                <td className={clsx(td, 'text-xs text-neutral-500')}>
                  {formatDateTime(s.expiresAt)}
                </td>
                <td className={clsx(td, 'text-right')}>
                  <button
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
  )
}
