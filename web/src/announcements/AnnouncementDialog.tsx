import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Pin } from 'lucide-react'
import type { UserAnnouncementDTO } from '@shared/types/api'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { Markdown } from '../chat/Markdown'
import { useActiveAnnouncements, useMarkAnnouncementRead } from '../hooks/useAnnouncements'
import { formatAnnouncementTime, LEVEL_META } from '../lib/announcementMeta'
import { useAnnouncementView } from '../store/announcementView'

const EMPTY_ANNOUNCEMENTS: UserAnnouncementDTO[] = []

/**
 * 公告详情 / 强提示弹窗（在 ChatLayout 挂载一次）。
 * - 用户从通知中心/横幅点开 → 展示该条详情（viewingId 优先）。
 * - 否则自动挑第一条「渠道=强弹窗且未确认」的公告。
 * - 自动强提示不可通过关闭按钮、Escape 或背景点击跳过；只有点「我知道了」
 *   写入确认回执后才消失，多条强提示会依次展示。
 */
export function AnnouncementDialog() {
  const { data } = useActiveAnnouncements()
  const viewingId = useAnnouncementView((s) => s.viewingId)
  const closeView = useAnnouncementView((s) => s.close)
  const markRead = useMarkAnnouncementRead()
  const [activeAutoId, setActiveAutoId] = useState<string | null>(null)

  const items = data ?? EMPTY_ANNOUNCEMENTS
  useEffect(() => {
    if (viewingId) return
    const activeStillValid = items.some(
      (announcement) =>
        announcement.id === activeAutoId && announcement.channel === 'modal' && !announcement.read,
    )
    if (activeStillValid) return
    const next = items.find(
      (announcement) => announcement.channel === 'modal' && !announcement.read,
    )
    setActiveAutoId(next?.id ?? null)
  }, [activeAutoId, items, viewingId])

  const manual = viewingId ? (items.find((a) => a.id === viewingId) ?? null) : null
  const auto =
    !manual && activeAutoId
      ? (items.find((announcement) => announcement.id === activeAutoId && !announcement.read) ??
        null)
      : null
  const current = manual ?? auto

  if (!current) return null
  return (
    <AnnouncementDialogView
      current={current}
      requiresAcknowledgement={current.channel === 'modal' && !current.read}
      acknowledging={markRead.isPending}
      onAcknowledge={() => markRead.mutate(current.id)}
      onClose={closeView}
    />
  )
}

/** 纯视图拆分便于锁定“未确认强提示不可关闭、普通详情可关闭”的交互契约。 */
export function AnnouncementDialogView({
  current,
  requiresAcknowledgement,
  acknowledging,
  onAcknowledge,
  onClose,
}: {
  current: UserAnnouncementDTO
  requiresAcknowledgement: boolean
  acknowledging: boolean
  onAcknowledge: () => void
  onClose: () => void
}) {
  const meta = LEVEL_META[current.level]
  const LevelIcon = meta.icon

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!requiresAcknowledgement}
      // 公告正文常含表格/长文，用 reading 宽档 + 固定高度撑出大方的阅读窗口。
      size="reading"
      height="fixed"
      // 只保留标题下的分隔线，底部按钮悬浮不画横线，减少一层线条。
      dividers="header"
      // 富标题：标题 + 「级别 · 时间 · 置顶」元信息行（全部 phrasing 元素，见 Modal 注释）。
      // 级别用小图标 + 彩色文字点到为止，不用彩底圆片——弹窗头部承受不了那个视觉重量。
      title={
        <span className="block min-w-0 py-1">
          <span className="block text-lg leading-snug font-semibold text-neutral-900 dark:text-neutral-100">
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
      // 已确认或非 modal 的手动详情可正常关闭；未确认强提示只保留明确确认按钮。
      footer={
        requiresAcknowledgement ? (
          <Button variant="primary" loading={acknowledging} onClick={onAcknowledge}>
            我知道了
          </Button>
        ) : undefined
      }
    >
      <Markdown text={current.body} />
    </Modal>
  )
}
