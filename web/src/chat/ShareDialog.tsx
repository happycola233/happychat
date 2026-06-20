import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Link2 } from 'lucide-react'
import {
  createShare,
  getConversationShare,
  revokeConversationShare,
} from '../api/shares'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Select } from '../components/ui/Select'
import { Toggle } from '../components/ui/Toggle'
import { copyToClipboard } from '../lib/clipboard'
import { toast } from '../store/toast'

type Expiry = 'never' | '7' | '30'

export function ShareDialog({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { data: share, isLoading } = useQuery({
    queryKey: ['conversation-share', conversationId],
    queryFn: () => getConversationShare(conversationId),
  })

  const [showAvatar, setShowAvatar] = useState(true)
  const [showName, setShowName] = useState(true)
  const [expiry, setExpiry] = useState<Expiry>('never')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (share) {
      setShowAvatar(share.showAvatar)
      setShowName(share.showName)
    }
  }, [share])

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['conversation-share', conversationId] })

  const save = useMutation({
    mutationFn: () =>
      createShare(conversationId, {
        showAvatar,
        showName,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      }),
    onSuccess: () => {
      invalidate()
      toast.success(share ? '已更新分享' : '已生成分享链接')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '分享失败'),
  })

  const revoke = useMutation({
    mutationFn: () => revokeConversationShare(conversationId),
    onSuccess: () => {
      invalidate()
      toast.success('已停止分享')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  const shareUrl = share ? `${window.location.origin}/s/${share.token}` : null

  const copy = () => {
    if (!shareUrl) return
    void copyToClipboard(shareUrl).then((ok) => {
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } else toast.error('复制失败')
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="分享聊天"
      footer={
        <>
          {share && (
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>
              停止分享
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            完成
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {share ? '更新分享' : '生成链接'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          分享后会生成一个公开链接，任何人都可只读查看当前对话的快照（后续新消息不会泄露）。
        </p>

        {share && shareUrl && (
          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/60">
            <Link2 className="h-4 w-4 shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-700 dark:text-neutral-200">
              {shareUrl}
            </span>
            <button
              onClick={copy}
              className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700"
              title="复制链接"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700"
              title="打开"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        )}

        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-neutral-800 dark:text-neutral-100">显示我的名称</span>
            <Toggle checked={showName} onChange={setShowName} />
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-neutral-800 dark:text-neutral-100">显示我的头像</span>
            <Toggle checked={showAvatar} onChange={setShowAvatar} />
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-neutral-800 dark:text-neutral-100">有效期</span>
            <Select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as Expiry)}
              options={[
                { value: 'never', label: '永久' },
                { value: '7', label: '7 天' },
                { value: '30', label: '30 天' },
              ]}
            />
          </div>
        </div>

        {share && (
          <p className="text-xs text-neutral-400">
            修改设置或对话有更新后，点「更新分享」可刷新链接内容。
          </p>
        )}
        {isLoading && <p className="text-xs text-neutral-400">加载中…</p>}
      </div>
    </Modal>
  )
}
