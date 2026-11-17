import { useState } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Check, Share2, SlidersHorizontal } from 'lucide-react'
import { isShareExpired, listMyShares } from '../../api/shares'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { Spinner } from '../../components/ui/Spinner'
import { copyToClipboard } from '../../lib/clipboard'
import { formatShortDate } from '../../lib/format'
import { useSettingsDialog } from '../../store/settingsDialog'
import { toast } from '../../store/toast'
import { CopyIcon, ExternalLinkIcon } from '../icons'
import { HOVER_REVEAL_CLASS } from '../rowMenu'
import { ShareDialog } from '../ShareDialog'

const ICON_BUTTON_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-black/[0.06] hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200 dark:focus-visible:ring-neutral-700'

/**
 * 「我的分享」页。
 * 每行：点击标题区跳回原对话；右侧提供 复制链接 / 打开分享页 / 分享设置 三个轻量操作，
 * 更新内容、改有效期、停止分享统一收进「分享设置」弹窗（与会话菜单里的分享是同一个），不在行内堆按钮。
 */
export function SharesPanel() {
  const navigate = useNavigate()
  const { closeDialog } = useSettingsDialog()
  const { data: shares, isLoading } = useQuery({ queryKey: ['my-shares'], queryFn: listMyShares })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  /** 正在通过分享设置弹窗管理的会话 id */
  const [managedId, setManagedId] = useState<string | null>(null)

  const copyLink = (id: string, token: string) => {
    void copyToClipboard(`${window.location.origin}/s/${token}`).then((ok) => {
      if (!ok) {
        toast.error('复制失败')
        return
      }
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    })
  }

  const openConversation = (conversationId: string) => {
    closeDialog()
    navigate(`/c/${conversationId}`)
  }

  const active = (shares ?? []).filter((s) => !s.revoked)

  return (
    <div>
      <SettingsSection description="分享链接是创建时定格的快照，对方无需登录即可查看；在「分享设置」中可更新内容、调整有效期或停止分享。">
        {isLoading ? (
          <div className="flex justify-center py-14">
            <Spinner className="h-5 w-5 text-neutral-400" />
          </div>
        ) : active.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <Share2 className="h-7 w-7 text-neutral-300 dark:text-neutral-600" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">还没有分享的聊天</p>
            <p className="text-[12.5px] text-neutral-400 dark:text-neutral-500">
              在会话右上角的「⋯」菜单里选择「分享」即可创建链接。
            </p>
          </div>
        ) : (
          active.map((s) => {
            const expired = isShareExpired(s)
            return (
              <div key={s.id} className="group flex items-center gap-1 py-3">
                <button
                  type="button"
                  onClick={() => openConversation(s.conversationId)}
                  title="在聊天中打开原对话"
                  className="group/title min-w-0 flex-1 text-left"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={clsx(
                        'truncate text-[14px] group-hover/title:underline',
                        expired
                          ? 'text-neutral-400 dark:text-neutral-500'
                          : 'text-neutral-900 dark:text-neutral-100',
                      )}
                    >
                      {s.title ?? '（无标题）'}
                    </span>
                    {expired && (
                      <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        已过期
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-neutral-500 dark:text-neutral-400">
                    分享于 {formatShortDate(s.updatedAt)} · {s.messageCount} 条消息
                    {!s.includeAttachments && ' · 不含附件'}
                    {s.expiresAt &&
                      ` · ${expired ? `已于 ${formatShortDate(s.expiresAt)} 过期` : `${formatShortDate(s.expiresAt)} 到期`}`}
                  </div>
                </button>
                <div
                  className={clsx(
                    'flex shrink-0 items-center gap-0.5 transition',
                    HOVER_REVEAL_CLASS,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => copyLink(s.id, s.token)}
                    disabled={expired}
                    aria-label="复制链接"
                    title={expired ? '链接已过期' : '复制链接'}
                    className={clsx(ICON_BUTTON_CLASS, expired && 'cursor-not-allowed opacity-40')}
                  >
                    {copiedId === s.id ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <CopyIcon className="h-4 w-4" />
                    )}
                  </button>
                  {expired ? (
                    <span
                      aria-hidden="true"
                      className={clsx(
                        ICON_BUTTON_CLASS,
                        'cursor-not-allowed opacity-40 hover:bg-transparent',
                      )}
                    >
                      <ExternalLinkIcon className="h-4 w-4" />
                    </span>
                  ) : (
                    <a
                      href={`/s/${s.token}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="打开分享页"
                      title="打开分享页"
                      className={ICON_BUTTON_CLASS}
                    >
                      <ExternalLinkIcon className="h-4 w-4" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setManagedId(s.conversationId)}
                    aria-label="分享设置"
                    title="分享设置（更新内容 / 有效期 / 停止分享）"
                    className={ICON_BUTTON_CLASS}
                    data-testid="my-share-manage"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </SettingsSection>
      {active.length > 0 && (
        <p className="mt-3 text-right text-[12px] text-neutral-400 dark:text-neutral-500">
          共 {active.length} 个分享
        </p>
      )}
      {managedId && <ShareDialog conversationId={managedId} onClose={() => setManagedId(null)} />}
    </div>
  )
}
