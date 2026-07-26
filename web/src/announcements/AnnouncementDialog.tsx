import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Pin } from 'lucide-react'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { Markdown } from '../chat/Markdown'
import {
  useActiveAnnouncements,
  useMarkAnnouncementRead,
  useRecordImpression,
} from '../hooks/useAnnouncements'
import { formatAnnouncementTime, LEVEL_META } from '../lib/announcementMeta'
import { useAnnouncementView } from '../store/announcementView'

/**
 * 公告详情 / 强提示弹窗（在 ChatLayout 挂载一次）。
 * - 用户从通知中心/横幅点开 → 展示该条详情（viewingId 优先）。
 * - 否则自动挑「渠道=强弹窗、未读、曝光未达上限」的公告弹出：
 *   每次展示上报一次曝光（impressions+1），达到「通知次数」上限后不再自动弹；
 *   点「我知道了」标记已读后也不再弹。
 */
export function AnnouncementDialog() {
  const { data } = useActiveAnnouncements()
  const viewingId = useAnnouncementView((s) => s.viewingId)
  const closeView = useAnnouncementView((s) => s.close)
  const markRead = useMarkAnnouncementRead()
  const recordImpression = useRecordImpression()

  // 当前正在自动展示的强弹窗 id
  const [activeAutoId, setActiveAutoId] = useState<string | null>(null)
  // 本次会话已「关闭（非确认）」的强弹窗 id：避免同一会话内反复弹
  const [dismissed, setDismissed] = useState<string[]>([])
  // 已上报曝光的 id（防同一挂载周期内重复上报）
  const impressed = useRef<Set<string>>(new Set())

  // 选取 / 清理自动弹窗；每次新选中上报一次曝光。
  useEffect(() => {
    if (viewingId) return // 手动查看优先，不自动弹
    const items = data ?? []
    // 当前弹窗已失效（已读 / 过期 / 被删）→ 释放，交由下一轮重新选取
    if (activeAutoId && !items.some((a) => a.id === activeAutoId && !a.read)) {
      setActiveAutoId(null)
      return
    }
    if (activeAutoId) return
    const next = items.find(
      (a) =>
        a.channel === 'modal' &&
        !a.read &&
        a.impressions < a.maxImpressions &&
        !dismissed.includes(a.id),
    )
    if (next) {
      setActiveAutoId(next.id)
      if (!impressed.current.has(next.id)) {
        impressed.current.add(next.id)
        recordImpression.mutate(next.id)
      }
    }
  }, [data, viewingId, activeAutoId, dismissed, recordImpression])

  const items = data ?? []
  const manual = viewingId ? (items.find((a) => a.id === viewingId) ?? null) : null
  const auto =
    !manual && activeAutoId ? (items.find((a) => a.id === activeAutoId && !a.read) ?? null) : null
  const current = manual ?? auto
  const isAuto = !manual && !!auto

  if (!current) return null
  const meta = LEVEL_META[current.level]
  const LevelIcon = meta.icon

  // 强弹窗主按钮「我知道了」：标记已读并收起（手动查看没有底部按钮，走 dismiss 关闭）
  const acknowledge = () => {
    markRead.mutate(current.id)
    setActiveAutoId(null)
  }
  // Esc / 点背景：强弹窗仅本会话关闭（不确认，之后仍可能再弹到次数上限）
  const dismiss = () => {
    if (isAuto) {
      setDismissed((d) => (d.includes(current.id) ? d : [...d, current.id]))
      setActiveAutoId(null)
    } else {
      closeView()
    }
  }

  return (
    <Modal
      open
      onClose={dismiss}
      height="fixed"
      // 富标题：标题 + 「级别 · 时间 · 置顶」元信息行（全部 phrasing 元素，见 Modal 注释）。
      // 级别只用小图标 + 彩色文字点到为止，不用彩底圆片——弹窗头部承受不了那个视觉重量。
      title={
        <span className="block min-w-0">
          <span className="block text-base leading-snug font-semibold text-neutral-900 dark:text-neutral-100">
            {current.title}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-xs font-normal text-neutral-400 dark:text-neutral-500">
            <span className={clsx('flex items-center gap-1 font-medium', meta.accentClass)}>
              <LevelIcon className="h-3.5 w-3.5" />
              {meta.label}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatAnnouncementTime(current.createdAt)}</span>
            {current.pinned && (
              <Pin className="h-3 w-3 rotate-45 text-neutral-300 dark:text-neutral-600" />
            )}
          </span>
        </span>
      }
      // 手动查看不需要底部按钮（右上角 X / Esc / 点背景均可关闭）；强弹窗保留「我知道了」确认
      footer={
        isAuto ? (
          <Button variant="primary" onClick={acknowledge}>
            我知道了
          </Button>
        ) : undefined
      }
    >
      <Markdown text={current.body} />
    </Modal>
  )
}
