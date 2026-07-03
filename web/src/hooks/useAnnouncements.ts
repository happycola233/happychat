import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UserAnnouncementDTO } from '@shared/types/api'
import {
  getActiveAnnouncements,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  recordAnnouncementImpression,
} from '../api/announcements'
import { useMe } from './useAuth'

/** 当前用户生效公告的查询 key。 */
export const ANNOUNCEMENTS_KEY = ['announcements', 'active'] as const

/**
 * 拉取当前对该用户生效的公告（含是否已读）。
 * 仅登录后启用；60s 轮询让新发布的公告无需刷新即可出现。
 */
export function useActiveAnnouncements() {
  const { data: me } = useMe()
  return useQuery({
    queryKey: ANNOUNCEMENTS_KEY,
    queryFn: getActiveAnnouncements,
    enabled: !!me,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

function patchCache(
  qc: ReturnType<typeof useQueryClient>,
  updater: (a: UserAnnouncementDTO) => UserAnnouncementDTO,
) {
  qc.setQueryData<UserAnnouncementDTO[]>(ANNOUNCEMENTS_KEY, (prev) => prev?.map(updater))
}

/** 标记单条已读（乐观更新，失败回滚）。 */
export function useMarkAnnouncementRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markAnnouncementRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ANNOUNCEMENTS_KEY })
      const previous = qc.getQueryData<UserAnnouncementDTO[]>(ANNOUNCEMENTS_KEY)
      patchCache(qc, (a) => (a.id === id ? { ...a, read: true } : a))
      return { previous }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(ANNOUNCEMENTS_KEY, ctx.previous)
    },
  })
}

/** 记录一次强弹窗曝光（乐观 impressions+1）。 */
export function useRecordImpression() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => recordAnnouncementImpression(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ANNOUNCEMENTS_KEY })
      const previous = qc.getQueryData<UserAnnouncementDTO[]>(ANNOUNCEMENTS_KEY)
      patchCache(qc, (a) => (a.id === id ? { ...a, impressions: a.impressions + 1 } : a))
      return { previous }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(ANNOUNCEMENTS_KEY, ctx.previous)
    },
  })
}

/** 全部标记已读（乐观更新，失败回滚）。 */
export function useMarkAllAnnouncementsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markAllAnnouncementsRead,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ANNOUNCEMENTS_KEY })
      const previous = qc.getQueryData<UserAnnouncementDTO[]>(ANNOUNCEMENTS_KEY)
      patchCache(qc, (a) => ({ ...a, read: true }))
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(ANNOUNCEMENTS_KEY, ctx.previous)
    },
  })
}
