import type {
  AdminAnnouncementDTO,
  AnnouncementReaderDTO,
  UserAnnouncementDTO,
} from '@shared/types/api'
import type {
  AnnouncementCreateInput,
  AnnouncementUpdateInput,
} from '@shared/schemas/announcement'
import { apiDelete, apiGet, apiPatch, apiPost } from './client'

// ---------------- 管理端 CRUD（/admin/*，RequireAdmin） ----------------

export const listAdminAnnouncements = () =>
  apiGet<{ announcements: AdminAnnouncementDTO[] }>('/admin/announcements').then(
    (r) => r.announcements,
  )

export const createAnnouncement = (input: AnnouncementCreateInput) =>
  apiPost<{ announcement: AdminAnnouncementDTO }>('/admin/announcements', input).then(
    (r) => r.announcement,
  )

export const updateAnnouncement = (id: string, input: AnnouncementUpdateInput) =>
  apiPatch<{ announcement: AdminAnnouncementDTO }>(`/admin/announcements/${id}`, input).then(
    (r) => r.announcement,
  )

export const deleteAnnouncement = (id: string) =>
  apiDelete<{ ok: true }>(`/admin/announcements/${id}`)

export const listAnnouncementReaders = (id: string) =>
  apiGet<{ readers: AnnouncementReaderDTO[] }>(`/admin/announcements/${id}/readers`).then(
    (r) => r.readers,
  )

export const resetAnnouncementReads = (id: string) =>
  apiPost<{ ok: true }>(`/admin/announcements/${id}/reset-reads`)

// ---------------- 用户端（/announcements/*，需登录） ----------------

export const getActiveAnnouncements = () =>
  apiGet<{ announcements: UserAnnouncementDTO[] }>('/announcements/active').then(
    (r) => r.announcements,
  )

export const markAnnouncementRead = (id: string) =>
  apiPost<{ ok: true }>(`/announcements/${id}/read`)

export const recordAnnouncementImpression = (id: string) =>
  apiPost<{ ok: true }>(`/announcements/${id}/impression`)

export const markAllAnnouncementsRead = () =>
  apiPost<{ ok: true; marked: number }>('/announcements/read-all')
