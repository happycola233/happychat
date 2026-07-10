import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pin, Plus, RotateCcw, Users } from 'lucide-react'
import type { AdminAnnouncementDTO } from '@shared/types/api'
import {
  deleteAnnouncement,
  listAdminAnnouncements,
  listAnnouncementReaders,
  resetAnnouncementReads,
} from '../../api/announcements'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { PageHeader } from '../../components/ui/PageHeader'
import { Spinner } from '../../components/ui/Spinner'
import { tableScroll, tableShell } from '../../components/ui/tableStyles'
import {
  AUDIENCE_LABEL,
  CHANNEL_LABEL,
  formatAnnouncementTime,
  LEVEL_META,
  PHASE_META,
} from '../../lib/announcementMeta'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { DeleteIcon } from '../../chat/icons'
import { AnnouncementEditor } from './AnnouncementEditor'

/** 「谁已读」名单弹窗。 */
function ReadersModal({
  announcement,
  onClose,
}: {
  announcement: AdminAnnouncementDTO
  onClose: () => void
}) {
  const { data: readers, isLoading } = useQuery({
    queryKey: ['admin', 'announcements', announcement.id, 'readers'],
    queryFn: () => listAnnouncementReaders(announcement.id),
  })
  return (
    <Modal open onClose={onClose} title={`已读名单 · ${announcement.title}`}>
      <div className="mb-3 text-sm text-neutral-500">
        已读 {announcement.readCount} / {announcement.audienceCount} 人
      </div>
      {isLoading ? (
        <div className="py-10 text-center">
          <Spinner className="h-5 w-5 text-neutral-400" />
        </div>
      ) : !readers?.length ? (
        <div className="py-10 text-center text-sm text-neutral-400">还没有人已读</div>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {readers.map((r) => (
            <li key={r.userId} className="flex items-center justify-between gap-3 py-2.5">
              <span className="truncate text-sm text-neutral-800 dark:text-neutral-100">
                {r.displayName ? `${r.displayName}（${r.username}）` : r.username}
              </span>
              <span className="shrink-0 text-xs text-neutral-400">
                {formatAnnouncementTime(r.readAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AnnouncementsPage() {
  const qc = useQueryClient()
  const { data: list, isLoading } = useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: listAdminAnnouncements,
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminAnnouncementDTO | null>(null)
  const [readersOf, setReadersOf] = useState<AdminAnnouncementDTO | null>(null)

  const openCreate = () => {
    setEditing(null)
    setEditorOpen(true)
  }
  const openEdit = (a: AdminAnnouncementDTO) => {
    setEditing(a)
    setEditorOpen(true)
  }

  const remove = useMutation({
    mutationFn: deleteAnnouncement,
    onSuccess: () => {
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  const resetReads = useMutation({
    mutationFn: resetAnnouncementReads,
    onSuccess: () => {
      toast.success('已重置，将对全部受众再次推送')
      qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '重置失败'),
  })

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="公告"
        description="发布站内公告：Markdown 正文、级别配色、触达渠道（铃铛 / 横幅 / 强弹窗）、定时发布与过期。"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> 新建公告
          </Button>
        }
      />

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !list?.length ? (
        <EmptyState
          title="还没有公告"
          action={
            <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> 新建公告
            </Button>
          }
        />
      ) : (
        <div className={tableScroll}>
          <div className={`${tableShell} min-w-[820px]`}>
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">公告</th>
                  <th className="px-4 py-3 font-medium">渠道</th>
                  <th className="px-4 py-3 font-medium">受众</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">已读</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {list.map((a) => {
                  const level = LEVEL_META[a.level]
                  const phase = PHASE_META[a.phase]
                  return (
                    <tr key={a.id} className="bg-white align-middle dark:bg-neutral-900">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {a.pinned && (
                            <Pin className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-label="置顶" />
                          )}
                          <Badge tone={level.tone}>{level.label}</Badge>
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">
                            {a.title}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-neutral-400">
                          {a.createdByName ? `${a.createdByName} · ` : ''}
                          创建于 {formatDateTime(a.createdAt)}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                        {CHANNEL_LABEL[a.channel]}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                        {AUDIENCE_LABEL[a.audience]}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={phase.tone}>{phase.label}</Badge>
                        {(a.publishAt != null || a.expiresAt != null) && (
                          <div className="mt-1 space-y-0.5 text-xs text-neutral-400">
                            {a.publishAt != null && <div>发布 {formatDateTime(a.publishAt)}</div>}
                            {a.expiresAt != null && <div>过期 {formatDateTime(a.expiresAt)}</div>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setReadersOf(a)}
                          title="查看已读名单"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm tabular-nums text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                        >
                          <Users className="h-3.5 w-3.5 text-neutral-400" />
                          {a.readCount}
                          <span className="text-neutral-400">/{a.audienceCount}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {/* flex 行让图标按钮与文字按钮垂直居中对齐（inline 元素会按基线错位） */}
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            className="!px-2.5 !py-1 text-xs"
                            onClick={() => {
                              void askConfirm({
                                title: '重置已读状态？',
                                description: `公告「${a.title}」的已读回执将被清空，并对全部受众重新推送。`,
                                confirmLabel: '重置并推送',
                              }).then((ok) => {
                                if (ok) resetReads.mutate(a.id)
                              })
                            }}
                            title="重置已读（重新推送）"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            className="!px-2.5 !py-1 text-xs"
                            onClick={() => openEdit(a)}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            className="!px-2.5 !py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => {
                              void askConfirm({
                                title: '删除公告？',
                                description: `公告「${a.title}」将被永久删除，且无法恢复。`,
                                confirmLabel: '删除',
                                tone: 'danger',
                              }).then((ok) => {
                                if (ok) remove.mutate(a.id)
                              })
                            }}
                          >
                            <DeleteIcon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editorOpen && (
        <AnnouncementEditor announcement={editing} onClose={() => setEditorOpen(false)} />
      )}
      {readersOf && (
        <ReadersModal announcement={readersOf} onClose={() => setReadersOf(null)} />
      )}
    </div>
  )
}
