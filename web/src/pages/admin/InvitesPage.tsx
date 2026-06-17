import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import * as adminApi from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { TextField } from '../../components/ui/TextField'
import { copyToClipboard } from '../../lib/clipboard'
import { toast } from '../../store/toast'

const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleString('zh-CN') : '永久')

export default function InvitesPage() {
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
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">邀请码</h1>
          <p className="mt-1 text-sm text-neutral-500">注册需要有效邀请码（首位用户除外）</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> 生成邀请码
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !invites?.length ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          还没有邀请码
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-3 font-medium">邀请码</th>
                <th className="px-4 py-3 font-medium">用量</th>
                <th className="px-4 py-3 font-medium">过期</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {invites.map((iv) => (
                <tr key={iv.id} className="bg-white dark:bg-neutral-900">
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-neutral-500">
                    {iv.usedCount}/{iv.maxUses}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{fmt(iv.expiresAt)}</td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-right">
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
        <TextField label="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：给朋友 A" />
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
