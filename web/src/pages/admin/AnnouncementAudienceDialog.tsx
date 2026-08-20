import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { ANNOUNCEMENT_AUDIENCE_USER_LIMIT } from '@shared/schemas/announcement'
import type { AdminUserDTO, AnnouncementAudienceDTO } from '@shared/types/api'
import { getAnnouncementAudience } from '../../api/announcements'
import { listUsers } from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useMe } from '../../hooks/useAuth'
import { keepExistingUserScopeIds } from './userScopeSelection'
import { UserScopePanel } from './UserScopePanel'
import type { UserScopePanelCopy } from './UserScopePanel'

interface Props {
  announcementId: string | null
  announcementTitle: string
  initialScope: AnnouncementAudienceDTO | null
  initialBaseline: AnnouncementAudienceDTO | null
  onApply: (scope: AnnouncementAudienceDTO, baselineScope: AnnouncementAudienceDTO) => void
  onClose: () => void
}

interface AudienceSnapshot {
  scope: AnnouncementAudienceDTO
  baselineScope: AnnouncementAudienceDTO
  users: AdminUserDTO[]
  ignoredUserCount: number
}

const ANNOUNCEMENT_SCOPE_COPY: UserScopePanelCopy = {
  allCaption: '所有账号都能收到此公告，之后新注册的账号也会自动纳入仍有效的公告。',
  selectedCaption: '仅勾选的账号能收到此公告，新注册账号默认不会收到。',
  allSummary: (userCount) => `当前 ${userCount} 位用户均可收到`,
  allDescription: '新注册的账号会自动纳入受众，无需再次配置',
  emptySelection: '请至少选择 1 位用户；若暂不推送，请将公告保存为草稿。',
  selectionOverLimit: (limit, selectedCount) =>
    `最多选择 ${limit.toLocaleString('zh-CN')} 位用户；当前已选 ${selectedCount.toLocaleString('zh-CN')} 位。`,
}

async function loadAudienceSnapshot(
  announcementId: string | null,
  initialScope: AnnouncementAudienceDTO | null,
  initialBaseline: AnnouncementAudienceDTO | null,
): Promise<AudienceSnapshot> {
  let users = await listUsers()
  const loadedScope =
    initialScope ??
    (announcementId
      ? await getAnnouncementAudience(announcementId)
      : { audience: 'all' as const, userIds: [] })
  const baselineScope = initialBaseline ?? loadedScope
  let userIds = keepExistingUserScopeIds(loadedScope.userIds, users)
  let baselineUserIds = keepExistingUserScopeIds(baselineScope.userIds, users)
  if (
    userIds.length !== loadedScope.userIds.length ||
    baselineUserIds.length !== baselineScope.userIds.length
  ) {
    users = await listUsers()
    userIds = keepExistingUserScopeIds(loadedScope.userIds, users)
    baselineUserIds = keepExistingUserScopeIds(baselineScope.userIds, users)
  }
  return {
    scope: { audience: loadedScope.audience, userIds },
    baselineScope: { audience: baselineScope.audience, userIds: baselineUserIds },
    users,
    ignoredUserCount: loadedScope.userIds.length - userIds.length,
  }
}

/** 公告编辑器的受众草稿面板；只有外层公告保存时才写入数据库。 */
export function AnnouncementAudienceDialog({
  announcementId,
  announcementTitle,
  initialScope,
  initialBaseline,
  onApply,
  onClose,
}: Props) {
  const snapshot = useQuery({
    queryKey: ['admin', 'announcement-audience-editor', announcementId ?? 'new'],
    queryFn: () => loadAudienceSnapshot(announcementId, initialScope, initialBaseline),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  if (snapshot.data && snapshot.isFetchedAfterMount) {
    return (
      <AudienceEditor
        key={`${announcementId ?? 'new'}:${snapshot.dataUpdatedAt}`}
        title={announcementTitle}
        snapshot={snapshot.data}
        onApply={onApply}
        onClose={onClose}
      />
    )
  }

  return (
    <Modal open onClose={onClose} title={`推送受众 · ${announcementTitle}`} size="form">
      {snapshot.error && snapshot.isFetchedAfterMount ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-red-500">
            {snapshot.error instanceof Error ? snapshot.error.message : '加载公告受众失败'}
          </p>
          <Button variant="secondary" className="!px-3 !py-2" onClick={() => snapshot.refetch()}>
            重新加载
          </Button>
        </div>
      ) : (
        <div className="flex min-h-52 items-center justify-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      )}
    </Modal>
  )
}

function AudienceEditor({
  title,
  snapshot,
  onApply,
  onClose,
}: {
  title: string
  snapshot: AudienceSnapshot
  onApply: (scope: AnnouncementAudienceDTO, baselineScope: AnnouncementAudienceDTO) => void
  onClose: () => void
}) {
  const { data: me } = useMe()
  const [audience, setAudience] = useState(snapshot.scope.audience)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(snapshot.scope.userIds))
  const emptySelection = audience === 'selected' && selected.size === 0
  const selectionOverLimit =
    audience === 'selected' && selected.size > ANNOUNCEMENT_AUDIENCE_USER_LIMIT

  return (
    <Modal
      open
      onClose={onClose}
      title={`推送受众 · ${title}`}
      size="form"
      footer={
        <>
          <span
            aria-live="polite"
            className="mr-auto min-w-0 self-center truncate text-xs tabular-nums text-neutral-400 dark:text-neutral-500"
          >
            {audience === 'all'
              ? `全部 ${snapshot.users.length} 位用户可收到`
              : `已选 ${selected.size} / ${snapshot.users.length} 位用户`}
          </span>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={emptySelection || selectionOverLimit}
            onClick={() =>
              onApply(
                {
                  audience,
                  userIds: audience === 'selected' ? [...selected] : [],
                },
                snapshot.baselineScope,
              )
            }
          >
            保存受众
          </Button>
        </>
      }
    >
      <div className="flex h-[min(62vh,32rem)] min-h-0 flex-col gap-3 overflow-hidden">
        {snapshot.ignoredUserCount > 0 && (
          <p
            role="status"
            className="flex shrink-0 items-start gap-2 rounded-lg border border-sky-200/70 bg-sky-50/70 px-3 py-2 text-xs leading-5 text-sky-700 dark:border-sky-500/20 dark:bg-sky-950/30 dark:text-sky-300"
          >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            已移除 {snapshot.ignoredUserCount} 个不存在的账号，请重新确认受众。
          </p>
        )}
        <UserScopePanel
          users={snapshot.users}
          mode={audience}
          selected={selected}
          onModeChange={setAudience}
          onSelectionChange={setSelected}
          currentUserId={me?.id}
          selectionLimit={ANNOUNCEMENT_AUDIENCE_USER_LIMIT}
          copy={ANNOUNCEMENT_SCOPE_COPY}
          radioGroupLabel="公告推送受众模式"
        />
      </div>
    </Modal>
  )
}
