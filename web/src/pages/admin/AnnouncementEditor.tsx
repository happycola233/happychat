import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Eye, UsersRound } from 'lucide-react'
import type { AdminAnnouncementDTO, AnnouncementAudienceDTO } from '@shared/types/api'
import type {
  AnnouncementChannel,
  AnnouncementLevel,
  AnnouncementStatus,
} from '@shared/types/domain'
import {
  createAnnouncement,
  getAnnouncementAudience,
  updateAnnouncement,
} from '../../api/announcements'
import { ApiRequestError } from '../../api/client'
import { Markdown } from '../../chat/Markdown'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { TextField } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { CHANNEL_LABEL, formatAnnouncementAudience, LEVEL_META } from '../../lib/announcementMeta'
import { toast } from '../../store/toast'
import { AnnouncementAudienceDialog } from './AnnouncementAudienceDialog'
import { sameUserScope } from './userScopeSelection'

interface Props {
  announcement: AdminAnnouncementDTO | null
  onClose: () => void
}

// epoch ms ↔ <input type="datetime-local"> 的本地时间字符串互转。
function msToLocalInput(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToMs(v: string): number | null {
  if (!v) return null
  const ms = new Date(v).getTime()
  return Number.isNaN(ms) ? null : ms
}

const LEVEL_OPTIONS = (Object.keys(LEVEL_META) as AnnouncementLevel[]).map((v) => ({
  value: v,
  label: LEVEL_META[v].label,
}))
const CHANNEL_OPTIONS = (Object.keys(CHANNEL_LABEL) as AnnouncementChannel[]).map((v) => ({
  value: v,
  label: CHANNEL_LABEL[v],
}))
const STATUS_OPTIONS: { value: AnnouncementStatus; label: string }[] = [
  { value: 'draft', label: '草稿（不对用户可见）' },
  { value: 'published', label: '已发布' },
]

const textareaClass =
  'h-full min-h-[260px] w-full resize-y rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 font-mono text-[13px] leading-6 text-neutral-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100'

export function AnnouncementEditor({ announcement, onClose }: Props) {
  const qc = useQueryClient()
  const editing = !!announcement

  const [title, setTitle] = useState(announcement?.title ?? '')
  const [body, setBody] = useState(announcement?.body ?? '')
  const [level, setLevel] = useState<AnnouncementLevel>(announcement?.level ?? 'info')
  const [channel, setChannel] = useState<AnnouncementChannel>(announcement?.channel ?? 'silent')
  // selected 公告的完整名单按需加载；未打开面板就保存时不触碰既有受众。
  const [audienceScope, setAudienceScope] = useState<AnnouncementAudienceDTO | null>(() =>
    !announcement ? { audience: 'all', userIds: [] } : null,
  )
  const [audienceBaseline, setAudienceBaseline] = useState<AnnouncementAudienceDTO | null>(null)
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [status, setStatus] = useState<AnnouncementStatus>(announcement?.status ?? 'draft')
  const [pinned, setPinned] = useState(announcement?.pinned ?? false)
  const [maxImpressions, setMaxImpressions] = useState(announcement?.maxImpressions ?? 1)
  const [scheduled, setScheduled] = useState(announcement?.publishAt != null)
  const [publishAt, setPublishAt] = useState(msToLocalInput(announcement?.publishAt ?? null))
  const [hasExpiry, setHasExpiry] = useState(announcement?.expiresAt != null)
  const [expiresAt, setExpiresAt] = useState(msToLocalInput(announcement?.expiresAt ?? null))

  const save = useMutation({
    mutationFn: async () => {
      const publishMs = scheduled ? localInputToMs(publishAt) : null
      const expiryMs = hasExpiry ? localInputToMs(expiresAt) : null
      const payload = {
        title: title.trim(),
        body,
        level,
        channel,
        status,
        pinned,
        maxImpressions,
        publishAt: publishMs,
        expiresAt: expiryMs,
      }
      if (editing) {
        if (audienceScope && audienceBaseline) {
          const latestAudience = await getAnnouncementAudience(announcement.id)
          const audienceUnchanged = sameUserScope(
            { mode: latestAudience.audience, userIds: latestAudience.userIds },
            { mode: audienceBaseline.audience, userIds: audienceBaseline.userIds },
          )
          if (!audienceUnchanged) throw new AnnouncementAudienceChangedError()
        }
        return updateAnnouncement(announcement.id, {
          ...payload,
          ...(audienceScope
            ? { audience: audienceScope.audience, userIds: audienceScope.userIds }
            : {}),
        })
      }
      const createAudience = audienceScope ?? { audience: 'all' as const, userIds: [] }
      return createAnnouncement({ ...payload, ...createAudience })
    },
    onSuccess: () => {
      toast.success(editing ? '已保存' : '已创建')
      qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
      qc.invalidateQueries({ queryKey: ['announcements', 'active'] })
      onClose()
    },
    onError: (error) => {
      if (error instanceof AnnouncementAudienceChangedError) {
        toast.error('推送受众已被其他操作更新，已重新加载最新名单')
        setAudienceScope(null)
        setAudienceBaseline(null)
        setAudienceOpen(true)
        return
      }
      if (error instanceof ApiRequestError && error.code === 'unknown_users') {
        toast.error('有账号在编辑期间被删除，请重新确认推送受众')
        setAudienceScope(null)
        setAudienceBaseline(null)
        setAudienceOpen(true)
        return
      }
      toast.error(error instanceof Error ? error.message : '保存失败')
    },
  })

  const onSave = () => {
    if (!title.trim()) return toast.error('请填写标题')
    if (!body.trim()) return toast.error('请填写正文')
    if (scheduled && !publishAt) return toast.error('请选择定时发布时间')
    if (hasExpiry && !expiresAt) return toast.error('请选择过期时间')
    const p = scheduled ? localInputToMs(publishAt) : null
    const x = hasExpiry ? localInputToMs(expiresAt) : null
    if (p != null && x != null && x <= p) return toast.error('过期时间必须晚于发布时间')
    save.mutate()
  }

  const effectiveAudience = audienceScope?.audience ?? announcement?.audience ?? 'all'
  const effectiveAudienceCount =
    effectiveAudience === 'selected'
      ? (audienceScope?.userIds.length ?? announcement?.audienceCount ?? 0)
      : (announcement?.audienceCount ?? 0)

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="wide"
        title={editing ? '编辑公告' : '新建公告'}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button loading={save.isPending} onClick={onSave}>
              {editing ? '保存' : '创建'}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {/* 基本信息 */}
          <div className="space-y-4">
            <TextField
              label="标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：今晚 02:00 系统维护通知"
              maxLength={200}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="级别"
                className="w-full"
                value={level}
                onChange={(e) => setLevel(e.target.value as AnnouncementLevel)}
                options={LEVEL_OPTIONS}
              />
              <Select
                label="触达渠道"
                className="w-full"
                value={channel}
                onChange={(e) => setChannel(e.target.value as AnnouncementChannel)}
                options={CHANNEL_OPTIONS}
              />
              <Select
                label="状态"
                className="w-full"
                value={status}
                onChange={(e) => setStatus(e.target.value as AnnouncementStatus)}
                options={STATUS_OPTIONS}
              />
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                推送受众
              </span>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setAudienceOpen(true)}
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-left outline-none transition hover:border-neutral-400 hover:bg-neutral-50 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/80"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300">
                  <UsersRound className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    {formatAnnouncementAudience(effectiveAudience, effectiveAudienceCount)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-400 dark:text-neutral-500">
                    点击配置所有用户或精确到具体账号
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
              </button>
            </div>
            <p className="text-xs text-neutral-400">
              渠道说明：<b>仅通知中心</b>=静默入铃铛；<b>顶部横幅</b>=聊天区顶部可关闭条；
              <b>强提示弹窗</b>=首次进入自动弹窗需确认。全部渠道均会进入铃铛通知中心。
            </p>
          </div>

          {/* 正文 + 实时预览 */}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                正文（Markdown）
              </span>
              <textarea
                className={textareaClass}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'支持 Markdown：**加粗**、[链接](https://…)、列表、`代码` 等'}
              />
            </label>
            <div className="block">
              <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                <Eye className="h-3.5 w-3.5" /> 实时预览
              </span>
              <div className="hc-scrollbar h-full min-h-[260px] overflow-y-auto rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
                {body.trim() ? (
                  <Markdown text={body} />
                ) : (
                  <p className="text-sm text-neutral-400">预览将在此显示…</p>
                )}
              </div>
            </div>
          </div>

          {/* 置顶 / 排期：无外框；pt 补回与 Markdown 区的间距，行距避免挤在一起 */}
          <div className="space-y-5 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-neutral-800 dark:text-neutral-100">置顶</div>
                <div className="mt-0.5 text-xs leading-5 text-neutral-400">
                  在通知中心与横幅中优先展示。
                </div>
              </div>
              <Toggle checked={pinned} onChange={setPinned} />
            </div>

            {channel === 'modal' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-neutral-800 dark:text-neutral-100">通知次数</div>
                  <div className="mt-0.5 text-xs leading-5 text-neutral-400">
                    强提示弹窗对每个用户最多自动弹出的次数（1–20）；点「我知道了」后不再弹。
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxImpressions}
                  onChange={(e) =>
                    setMaxImpressions(
                      Math.min(20, Math.max(1, Math.floor(Number(e.target.value) || 1))),
                    )
                  }
                  className="w-20 shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-center text-sm text-neutral-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-neutral-800 dark:text-neutral-100">定时发布</div>
                <div className="mt-0.5 text-xs leading-5 text-neutral-400">
                  关闭则发布后立即生效。
                </div>
              </div>
              <Toggle checked={scheduled} onChange={setScheduled} />
            </div>
            {scheduled && (
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
              />
            )}

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-neutral-800 dark:text-neutral-100">设置过期时间</div>
                <div className="mt-0.5 text-xs leading-5 text-neutral-400">
                  到期后自动从用户端隐藏。
                </div>
              </div>
              <Toggle checked={hasExpiry} onChange={setHasExpiry} />
            </div>
            {hasExpiry && (
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            )}
          </div>
        </div>
      </Modal>
      {audienceOpen && (
        <AnnouncementAudienceDialog
          announcementId={announcement?.id ?? null}
          announcementTitle={title.trim() || announcement?.title || '未命名公告'}
          initialScope={audienceScope}
          initialBaseline={audienceBaseline}
          onApply={(scope, baselineScope) => {
            setAudienceScope(scope)
            setAudienceBaseline(baselineScope)
            setAudienceOpen(false)
          }}
          onClose={() => setAudienceOpen(false)}
        />
      )}
    </>
  )
}

class AnnouncementAudienceChangedError extends Error {
  constructor() {
    super('公告受众已变化')
    this.name = 'AnnouncementAudienceChangedError'
  }
}
