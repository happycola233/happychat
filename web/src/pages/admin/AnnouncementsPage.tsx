import { LoadError } from '../../components/ui/LoadError'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Pin, Plus, RotateCcw, Users } from 'lucide-react'
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
import { SearchField } from '../../components/ui/SearchField'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { AnnouncementReader } from '../../announcements/AnnouncementReader'
import {
  responsiveTableBody as tableBody,
  responsiveTable as tableEl,
  responsiveTableHead as tableHead,
  responsiveTableRow as tableRowHover,
  mobileCellLabel,
  tableScroll,
  tableShell,
  responsiveTd as td,
  th,
} from '../../components/ui/tableStyles'
import {
  CHANNEL_LABEL,
  formatAnnouncementAudience,
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
  const {
    data: list,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: listAdminAnnouncements,
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminAnnouncementDTO | null>(null)
  const [readersOf, setReadersOf] = useState<AdminAnnouncementDTO | null>(null)
  const [preview, setPreview] = useState<AdminAnnouncementDTO | null>(null)
  const [search, setSearch] = useState('')
  const [phaseFilter, setPhaseFilter] = useState('all')
  const keyword = search.trim().toLowerCase()
  const filtered = (list ?? []).filter(
    (announcement) =>
      (phaseFilter === 'all' || announcement.phase === phaseFilter) &&
      `${announcement.title} ${announcement.createdByName ?? ''}`.toLowerCase().includes(keyword),
  )

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
    <div className="space-y-5">
      <PageHeader
        title="公告"
        description="发布站内公告：Markdown 正文、级别配色、触达渠道（铃铛 / 横幅 / 强弹窗）、定时发布与过期。"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> 新建公告
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="搜索公告标题或发布者"
          className="min-w-48 flex-1"
        />
        <SegmentedControl
          label="公告状态"
          value={phaseFilter}
          onChange={setPhaseFilter}
          options={[
            { value: 'all', label: '全部', count: list?.length ?? 0 },
            ...Object.entries(PHASE_META).map(([value, meta]) => ({ value, label: meta.label })),
          ]}
        />
      </div>

      {isError && <LoadError hasData={Boolean(list)} onRetry={() => void refetch()} />}
      {isError && !list ? null : isLoading ? (
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
      ) : !filtered.length ? (
        <EmptyState
          title="没有匹配的公告"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('')
                setPhaseFilter('all')
              }}
            >
              清除筛选
            </Button>
          }
        />
      ) : (
        <div className={tableScroll}>
          <div className={tableShell}>
            <table className={tableEl}>
              <thead className={tableHead}>
                <tr>
                  <th scope="col" className={th}>
                    公告
                  </th>
                  <th scope="col" className={th}>
                    渠道
                  </th>
                  <th scope="col" className={th}>
                    受众
                  </th>
                  <th scope="col" className={th}>
                    状态
                  </th>
                  <th scope="col" className={th}>
                    已读
                  </th>
                  <th scope="col" className={th} aria-label="操作" />
                </tr>
              </thead>
              <tbody className={tableBody}>
                {filtered.map((a) => {
                  const level = LEVEL_META[a.level]
                  const phase = PHASE_META[a.phase]
                  return (
                    <tr key={a.id} className={tableRowHover}>
                      <td className={`${td} col-span-2`}>
                        <div className="flex items-center gap-1.5">
                          {a.pinned && (
                            <Pin
                              className="h-3.5 w-3.5 shrink-0 text-neutral-400"
                              aria-label="置顶"
                            />
                          )}
                          <Badge tone={level.tone}>{level.label}</Badge>
                          <button
                            type="button"
                            onClick={() => openEdit(a)}
                            className="min-w-0 truncate text-left font-medium text-neutral-900 hover:text-sky-600 dark:text-neutral-100 dark:hover:text-sky-400"
                          >
                            {a.title}
                          </button>
                        </div>
                        <div className="mt-1 text-xs text-neutral-400">
                          {a.createdByName ? `${a.createdByName} · ` : ''}
                          创建于 {formatDateTime(a.createdAt)}
                        </div>
                      </td>
                      <td
                        className={`${td} whitespace-nowrap text-neutral-600 dark:text-neutral-300`}
                      >
                        <span className={mobileCellLabel}>渠道</span>
                        {CHANNEL_LABEL[a.channel]}
                      </td>
                      <td
                        className={`${td} whitespace-nowrap text-neutral-600 dark:text-neutral-300`}
                      >
                        <span className={mobileCellLabel}>受众</span>
                        {formatAnnouncementAudience(a.audience, a.audienceCount)}
                      </td>
                      <td className={td}>
                        <span className={mobileCellLabel}>状态</span>
                        <Badge tone={phase.tone}>{phase.label}</Badge>
                        {(a.publishAt != null || a.expiresAt != null) && (
                          <div className="mt-1 space-y-0.5 text-xs text-neutral-400">
                            {a.publishAt != null && <div>发布 {formatDateTime(a.publishAt)}</div>}
                            {a.expiresAt != null && <div>过期 {formatDateTime(a.expiresAt)}</div>}
                          </div>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <span className={mobileCellLabel}>已读</span>
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
                      <td className={`${td} col-span-2`}>
                        {/* flex 行让图标按钮与文字按钮垂直居中对齐（inline 元素会按基线错位） */}
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setPreview(a)}>
                            <Eye className="h-3.5 w-3.5" />
                            预览
                          </Button>
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
                            aria-label="重置已读（重新推送）"
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
                            aria-label={`删除公告 ${a.title}`}
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
      {readersOf && <ReadersModal announcement={readersOf} onClose={() => setReadersOf(null)} />}
      {preview && (
        <AnnouncementReader
          preview
          announcement={preview}
          onClose={() => setPreview(null)}
          footer={
            <Button
              onClick={() => {
                openEdit(preview)
                setPreview(null)
              }}
            >
              编辑公告
            </Button>
          }
        />
      )}
    </div>
  )
}
