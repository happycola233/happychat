import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { UserAnnouncementDTO } from '@shared/types/api'
import { Button } from '../components/ui/Button'
import { IconButton } from '../components/ui/IconButton'
import { useActiveAnnouncements, useMarkAnnouncementRead } from '../hooks/useAnnouncements'
import { useAnnouncementView } from '../store/announcementView'
import { toast } from '../store/toast'
import { AnnouncementReader } from './AnnouncementReader'

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
  const openView = useAnnouncementView((s) => s.open)
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
  const currentIndex = items.findIndex((item) => item.id === current.id)
  const navigate = (index: number) => {
    const item = items[index]!
    if (!item.read && item.channel !== 'modal') markRead.mutate(item.id)
    openView(item.id)
  }
  return (
    <AnnouncementDialogView
      key={current.id}
      current={current}
      requiresAcknowledgement={current.channel === 'modal' && !current.read}
      acknowledging={markRead.isPending}
      onAcknowledge={() =>
        markRead.mutate(current.id, {
          onSuccess: closeView,
          onError: () => toast.error('确认失败，请重试'),
        })
      }
      onClose={closeView}
      navigation={
        manual
          ? {
              index: currentIndex,
              total: items.length,
              onPrevious: () => navigate(currentIndex - 1),
              onNext: () => navigate(currentIndex + 1),
            }
          : undefined
      }
      pendingCount={items.filter((item) => item.channel === 'modal' && !item.read).length}
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
  navigation,
  pendingCount = 1,
}: {
  current: UserAnnouncementDTO
  requiresAcknowledgement: boolean
  acknowledging: boolean
  onAcknowledge: () => void
  onClose: () => void
  navigation?: { index: number; total: number; onPrevious: () => void; onNext: () => void }
  pendingCount?: number
}) {
  return (
    <AnnouncementReader
      announcement={current}
      onClose={onClose}
      dismissible={!requiresAcknowledgement}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-neutral-500 dark:text-neutral-400">
            {requiresAcknowledgement ? (
              <span>{pendingCount > 1 ? `${pendingCount} 条公告待确认` : '阅读后请确认'}</span>
            ) : navigation && navigation.total > 1 ? (
              <div className="flex items-center gap-2">
                <IconButton
                  label="上一条公告"
                  className="!h-10 !w-10"
                  disabled={navigation.index === 0}
                  onClick={navigation.onPrevious}
                >
                  <ChevronLeft className="h-4 w-4" />
                </IconButton>
                <span className="tabular-nums">
                  {navigation.index + 1} / {navigation.total}
                </span>
                <IconButton
                  label="下一条公告"
                  className="!h-10 !w-10"
                  disabled={navigation.index === navigation.total - 1}
                  onClick={navigation.onNext}
                >
                  <ChevronRight className="h-4 w-4" />
                </IconButton>
              </div>
            ) : (
              <span>站内公告</span>
            )}
          </div>
          <Button
            variant={requiresAcknowledgement ? 'primary' : 'secondary'}
            className="!min-h-10 min-w-24 !px-5"
            loading={acknowledging && requiresAcknowledgement}
            onClick={requiresAcknowledgement ? onAcknowledge : onClose}
          >
            {requiresAcknowledgement ? '我知道了' : '关闭'}
          </Button>
        </div>
      }
    />
  )
}
