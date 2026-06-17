import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import type { AdminUserDTO } from '@shared/types/api'
import * as adminApi from '../../api/admin'
import { useMe } from '../../hooks/useAuth'
import { Spinner } from '../../components/ui/Spinner'
import { Toggle } from '../../components/ui/Toggle'
import { toast } from '../../store/toast'

const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—')

export default function UsersPage() {
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

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">用户</h1>
      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-3 font-medium">用户名</th>
                <th className="px-4 py-3 font-medium">管理员</th>
                <th className="px-4 py-3 font-medium">启用</th>
                <th className="px-4 py-3 font-medium">会话</th>
                <th className="px-4 py-3 font-medium">注册</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {users?.map((u: AdminUserDTO) => {
                const isSelf = u.id === me?.id
                return (
                  <tr key={u.id} className="bg-white dark:bg-neutral-900">
                    <td className="px-4 py-3 text-neutral-800 dark:text-neutral-100">
                      {u.username}
                      {isSelf && <span className="ml-1 text-xs text-neutral-400">（你）</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={u.role === 'admin'}
                        disabled={isSelf}
                        onChange={(v) =>
                          update.mutate({ id: u.id, input: { role: v ? 'admin' : 'user' } })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={!u.disabled}
                        disabled={isSelf}
                        onChange={(v) => update.mutate({ id: u.id, input: { disabled: !v } })}
                      />
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{u.conversationCount}</td>
                    <td className="px-4 py-3 text-xs text-neutral-500">{fmt(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {!isSelf && (
                        <button
                          onClick={() => {
                            if (confirm(`确定删除用户「${u.username}」？其会话与记录将一并删除。`))
                              remove.mutate(u.id)
                          }}
                          className="text-neutral-400 hover:text-red-500"
                          aria-label="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
