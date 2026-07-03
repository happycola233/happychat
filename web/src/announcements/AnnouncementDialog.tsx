import { useEffect, useRef, useState } from 'react'
import { Modal } from '../components/ui/Modal'
import { Badge } from '../components/ui/Badge'
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

  // 主按钮：确认（强弹窗→标记已读；详情→关闭）
  const acknowledge = () => {
    if (isAuto) {
      markRead.mutate(current.id)
      setActiveAutoId(null)
    } else {
      closeView()
    }
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
      title={current.title}
      footer={
        <Button variant={isAuto ? 'primary' : 'secondary'} onClick={acknowledge}>
          {isAuto ? '我知道了' : '关闭'}
        </Button>
      }
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-neutral-400">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span>{formatAnnouncementTime(current.createdAt)}</span>
      </div>
      <Markdown text={current.body} />
    </Modal>
  )
}
