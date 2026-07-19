import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, Link2, Paperclip } from 'lucide-react'
import { textFromContent } from '@shared/util/contentText'
import type { MessageDTO } from '@shared/types/api'
import { getConversation } from '../api/chat'
import {
  createShare,
  getConversationShare,
  invalidateShareQueries,
  isShareExpired,
  revokeConversationShare,
} from '../api/shares'
import { Button } from '../components/ui/Button'
import { IndeterminateCheckbox } from '../components/ui/IndeterminateCheckbox'
import { Modal } from '../components/ui/Modal'
import { Select } from '../components/ui/Select'
import { Spinner } from '../components/ui/Spinner'
import { Toggle } from '../components/ui/Toggle'
import { copyToClipboard } from '../lib/clipboard'
import { formatShortDate } from '../lib/format'
import { askConfirm } from '../store/confirm'
import { toast } from '../store/toast'
import { buildPath } from './buildPath'
import { CopyIcon, ExternalLinkIcon } from './icons'

type Expiry = 'keep' | 'never' | '7' | '30'

/** 用户上传附件（图片/文件）数量；模型生成的 image_result 属于回复内容，不计入。 */
function userAttachmentCount(m: MessageDTO): number {
  return m.content.filter((p) => p.type === 'input_image' || p.type === 'input_file').length
}

/** 列表行的单行内容预览：优先正文，无正文时描述附件/状态。 */
function messagePreview(m: MessageDTO): string {
  const text = textFromContent(m.content).replace(/\s+/g, ' ').trim()
  if (text) return text
  const labels: string[] = []
  const imageCount = m.content.filter((p) => p.type === 'input_image').length
  const files = m.content.filter((p) => p.type === 'input_file')
  if (imageCount > 0) labels.push(imageCount === 1 ? '图片' : `${imageCount} 张图片`)
  if (files.length > 0) {
    labels.push(files[0]!.filename + (files.length > 1 ? ` 等 ${files.length} 个文件` : ''))
  }
  if (m.content.some((p) => p.type === 'image_result')) labels.push('生成的图片')
  if (labels.length > 0) return labels.join(' · ')
  if (m.status === 'streaming') return '正在生成…'
  return '（无文本内容）'
}

function SectionTitle({ children, aside }: { children: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h4 className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">
        {children}
      </h4>
      {aside}
    </div>
  )
}

/** 快捷选择胶囊：点击把选择集整体设为该预设；当前选择与预设完全一致时高亮。 */
function QuickChip({
  label,
  active,
  onClick,
  testId,
}: {
  label: string
  active: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={clsx(
        'rounded-full border px-2.5 py-1 text-xs transition select-none',
        active
          ? 'border-sky-300 bg-sky-500/10 font-medium text-sky-600 dark:border-sky-500/40 dark:text-sky-400'
          : 'border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
      )}
    >
      {label}
    </button>
  )
}

export function ShareDialog({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const shareQuery = useQuery({
    queryKey: ['conversation-share', conversationId],
    queryFn: () => getConversationShare(conversationId),
  })
  const detailQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
  })
  const share = shareQuery.data ?? null
  const detail = detailQuery.data

  /** 候选消息 = 当前可见分支路径（根→叶）；选择天然满足「单一分支」约束。 */
  const path = useMemo(
    () => (detail ? buildPath(detail.messages, detail.conversation.activeLeafId) : []),
    [detail],
  )
  const prevSharedIds = useMemo(
    () => new Set(share?.sharedMessageIds ?? []),
    [share?.sharedMessageIds],
  )

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAvatar, setShowAvatar] = useState(true)
  const [showName, setShowName] = useState(true)
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [expiry, setExpiry] = useState<Expiry>('never')
  const [copied, setCopied] = useState(false)

  // 数据到位后按「当前分享」播种一次表单；分享身份变化（撤销后重建等）时重新播种。
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!shareQuery.isSuccess || !detail) return
    const key = share ? share.id : 'new'
    if (seededFor.current === key) return
    seededFor.current = key
    if (share) {
      setShowAvatar(share.showAvatar)
      setShowName(share.showName)
      setIncludeAttachments(share.includeAttachments)
      setExpiry('keep')
      // 预选 = 上次快照 ∩ 当前分支；分享后新增的消息保持未选，避免更新时意外泄露。
      setSelected(new Set(path.filter((m) => prevSharedIds.has(m.id)).map((m) => m.id)))
    } else {
      setShowAvatar(true)
      setShowName(true)
      setIncludeAttachments(true)
      setExpiry('never')
      setSelected(new Set(path.map((m) => m.id)))
    }
  }, [shareQuery.isSuccess, share, detail, path, prevSharedIds])

  const loading = shareQuery.isLoading || detailQuery.isLoading
  const expired = share ? isShareExpired(share) : false

  const allIds = useMemo(() => path.map((m) => m.id), [path])
  const userIds = useMemo(
    () => path.filter((m) => m.role === 'user').map((m) => m.id),
    [path],
  )
  const assistantIds = useMemo(
    () => path.filter((m) => m.role === 'assistant').map((m) => m.id),
    [path],
  )
  const newCount = share ? path.filter((m) => !prevSharedIds.has(m.id)).length : 0
  const missingCount = share
    ? [...prevSharedIds].filter((id) => !allIds.includes(id)).length
    : 0
  const hasUserAttachments = path.some((m) => userAttachmentCount(m) > 0)

  const equalsPreset = (ids: string[]) =>
    ids.length > 0 && selected.size === ids.length && ids.every((id) => selected.has(id))
  const applyPreset = (ids: string[]) => setSelected(new Set(ids))
  const toggleOne = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = useMutation({
    mutationFn: () =>
      createShare(conversationId, {
        showAvatar,
        showName,
        includeAttachments,
        expiresInDays: expiry === 'keep' ? 'keep' : expiry === 'never' ? null : Number(expiry),
        // 始终按当前分支顺序显式传选中集，服务端再做单分支校验。
        messageIds: allIds.filter((id) => selected.has(id)),
      }),
    onSuccess: () => {
      invalidateShareQueries(qc, conversationId)
      toast.success(share ? '已更新分享' : '已生成分享链接')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '分享失败'),
  })

  const revoke = useMutation({
    mutationFn: () => revokeConversationShare(conversationId),
    onSuccess: () => {
      invalidateShareQueries(qc, conversationId)
      toast.success('已停止分享，该链接已永久失效')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  const onRevoke = async () => {
    const ok = await askConfirm({
      title: '停止分享？',
      description: '当前链接将永久失效；之后再次分享会生成一个全新的链接，旧链接无法再次启用。',
      confirmLabel: '停止分享',
      tone: 'danger',
    })
    if (ok) revoke.mutate()
  }

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

  const expiryOptions = share
    ? [
        {
          value: 'keep',
          label: share.expiresAt
            ? expired
              ? `保持当前（已于 ${formatShortDate(share.expiresAt)} 过期）`
              : `保持当前（${formatShortDate(share.expiresAt)} 到期）`
            : '保持当前（永久有效）',
        },
        { value: 'never', label: '改为永久有效' },
        { value: '7', label: '7 天后过期（重新计时）' },
        { value: '30', label: '30 天后过期（重新计时）' },
      ]
    : [
        { value: 'never', label: '永久有效' },
        { value: '7', label: '7 天后过期' },
        { value: '30', label: '30 天后过期' },
      ]

  return (
    <Modal
      open
      onClose={onClose}
      title="分享聊天"
      size="form"
      footer={
        <>
          {share && (
            <Button
              variant="ghost"
              className="mr-auto text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
              loading={revoke.isPending}
              onClick={() => void onRevoke()}
              data-testid="share-revoke"
            >
              停止分享
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            完成
          </Button>
          <Button
            loading={save.isPending}
            disabled={loading || selected.size === 0}
            onClick={() => save.mutate()}
            data-testid="share-submit"
          >
            {share ? '更新分享' : '生成链接'}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : (
        <div className="space-y-5" data-testid="share-dialog">
          {share && shareUrl ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800/60">
                <Link2 className="h-4 w-4 shrink-0 text-neutral-400" />
                <span
                  className="min-w-0 flex-1 truncate text-sm text-neutral-700 dark:text-neutral-200"
                  data-testid="share-link"
                >
                  {shareUrl}
                </span>
                {expired && (
                  <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    已过期
                  </span>
                )}
                <button
                  onClick={copy}
                  className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                  title="复制链接"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <CopyIcon className="h-4 w-4" />
                  )}
                </button>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                  title="打开分享页"
                >
                  <ExternalLinkIcon className="h-4 w-4" />
                </a>
              </div>
              <p className="px-1 text-[12px] text-neutral-400">
                分享于 {formatShortDate(share.updatedAt)} · 包含 {share.messageCount} 条消息
                {expired && ' · 链接已过期，更新时可重新设置有效期'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              选择要分享的消息并生成公开链接，任何人都可只读查看这份快照；之后的新消息不会自动进入分享。
            </p>
          )}

          <section className="space-y-2.5">
            <SectionTitle
              aside={
                <span className="text-[12px] tabular-nums text-neutral-400">
                  已选 {selected.size} / {path.length} 条
                </span>
              }
            >
              分享内容
            </SectionTitle>

            <div className="flex flex-wrap items-center gap-1.5">
              <QuickChip
                label="全部消息"
                active={equalsPreset(allIds)}
                onClick={() => applyPreset(allIds)}
                testId="share-quick-all"
              />
              <QuickChip
                label="全部用户消息"
                active={equalsPreset(userIds)}
                onClick={() => applyPreset(userIds)}
                testId="share-quick-user"
              />
              <QuickChip
                label="全部 AI 回复"
                active={equalsPreset(assistantIds)}
                onClick={() => applyPreset(assistantIds)}
                testId="share-quick-ai"
              />
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded-full px-2 py-1 text-xs text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  清空
                </button>
              )}
            </div>

            <div className="hc-scrollbar max-h-[min(320px,40vh)] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {path.map((m) => {
                  const attachments = userAttachmentCount(m)
                  const isNew = share !== null && !prevSharedIds.has(m.id)
                  const isSelected = selected.has(m.id)
                  return (
                    <div
                      key={m.id}
                      role="button"
                      tabIndex={-1}
                      onClick={() => toggleOne(m.id)}
                      data-testid="share-message-row"
                      data-selected={isSelected}
                      className={clsx(
                        'flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors',
                        isSelected
                          ? 'bg-white dark:bg-transparent'
                          : 'bg-neutral-50/60 dark:bg-neutral-900/40',
                        'hover:bg-neutral-100/70 dark:hover:bg-neutral-800/50',
                      )}
                    >
                      <span onClick={(e) => e.stopPropagation()} className="flex">
                        <IndeterminateCheckbox
                          checked={isSelected}
                          onChange={() => toggleOne(m.id)}
                          ariaLabel={m.role === 'user' ? '选择这条用户消息' : '选择这条 AI 回复'}
                        />
                      </span>
                      <span
                        className={clsx(
                          'flex w-8 shrink-0 justify-center rounded-md px-1 py-0.5 text-[11px] font-medium',
                          m.role === 'user'
                            ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                            : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
                        )}
                      >
                        {m.role === 'user' ? '你' : 'AI'}
                      </span>
                      <span
                        className={clsx(
                          'min-w-0 flex-1 truncate text-[13px]',
                          isSelected
                            ? 'text-neutral-700 dark:text-neutral-200'
                            : 'text-neutral-400 dark:text-neutral-500',
                        )}
                      >
                        {messagePreview(m)}
                      </span>
                      {attachments > 0 && (
                        <span
                          className={clsx(
                            'flex shrink-0 items-center gap-0.5 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
                            !includeAttachments && 'opacity-40 line-through',
                          )}
                          title={includeAttachments ? `${attachments} 个附件` : '附件不会包含在分享中'}
                        >
                          <Paperclip className="h-3 w-3" />
                          {attachments}
                        </span>
                      )}
                      {isNew && (
                        <span className="shrink-0 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                          新
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {selected.size === 0 && (
              <p className="text-[12px] text-amber-600 dark:text-amber-400">
                至少选择一条消息才能分享。
              </p>
            )}
            {share !== null && newCount > 0 && (
              <p className="text-[12px] text-neutral-400">
                自上次分享后新增{' '}
                <span className="font-medium text-sky-600 dark:text-sky-400">{newCount}</span>{' '}
                条消息（标记为「新」），勾选后更新分享才会包含。
              </p>
            )}
            {share !== null && missingCount > 0 && (
              <p className="text-[12px] text-neutral-400">
                上次分享中有 {missingCount} 条消息不在当前分支上，更新后将不再包含。
              </p>
            )}
          </section>

          <section className="space-y-1">
            <SectionTitle>隐私与有效期</SectionTitle>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-neutral-800 dark:text-neutral-100">显示我的名称</span>
                <Toggle checked={showName} onChange={setShowName} />
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-neutral-800 dark:text-neutral-100">显示我的头像</span>
                <Toggle checked={showAvatar} onChange={setShowAvatar} />
              </div>
              {hasUserAttachments && (
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-800 dark:text-neutral-100">
                      包含我上传的图片与文件
                    </div>
                    <div className="mt-0.5 text-[12px] leading-5 text-neutral-400">
                      关闭后附件不会被公开，分享页以文字占位显示；AI 生成的图片不受影响。
                    </div>
                  </div>
                  <Toggle
                    checked={includeAttachments}
                    onChange={setIncludeAttachments}
                    ariaLabel="包含我上传的图片与文件"
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-4 py-2.5">
                <span className="shrink-0 text-sm text-neutral-800 dark:text-neutral-100">
                  有效期
                </span>
                <Select
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value as Expiry)}
                  options={expiryOptions}
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </Modal>
  )
}
