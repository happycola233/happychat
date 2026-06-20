import type {
  AdminModelDTO,
  AdminSessionDTO,
  AdminUserDTO,
  AnalyticsDTO,
  ErrorLogDTO,
  InviteCodeDTO,
  OverviewDTO,
  Paginated,
  ProviderDetailDTO,
  ProviderDTO,
  ProviderTestResult,
  StatsDTO,
  SyncModelsResult,
  UsageLogDTO,
  UserStatDTO,
} from '@shared/types/api'
import type {
  ModelCreateInput,
  ModelReorderInput,
  ModelUpdateInput,
  ProviderCreateInput,
  ProviderUpdateInput,
} from '@shared/schemas/model-config'
import type { InviteCreateInput, UserUpdateInput } from '@shared/schemas/admin'
import { apiDelete, apiGet, apiPatch, apiPost } from './client'

/** 统计/事件查询参数（与后端 statsFilterSchema 对应）。 */
export interface StatsQuery {
  from?: number
  to?: number
  providerId?: string
  modelId?: string
  userId?: string
  success?: boolean
  scope?: string
  search?: string
  bucket?: 'hour' | 'day'
  page?: number
  pageSize?: number
}

function qs(query: StatsQuery = {}): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const listProviders = () =>
  apiGet<{ providers: ProviderDTO[] }>('/admin/providers').then((r) => r.providers)
export const getProvider = (id: string) =>
  apiGet<{ provider: ProviderDetailDTO }>(`/admin/providers/${id}`).then((r) => r.provider)
export const createProvider = (input: ProviderCreateInput) =>
  apiPost<{ id: string }>('/admin/providers', input)
export const updateProvider = (id: string, input: ProviderUpdateInput) =>
  apiPatch<{ ok: true }>(`/admin/providers/${id}`, input)
export const deleteProvider = (id: string) => apiDelete<{ ok: true }>(`/admin/providers/${id}`)
export const testProvider = (id: string) =>
  apiPost<ProviderTestResult>(`/admin/providers/${id}/test`)
export const syncModels = (id: string) => apiPost<SyncModelsResult>(`/admin/providers/${id}/sync`)

export const listAdminModels = () =>
  apiGet<{ models: AdminModelDTO[] }>('/admin/models').then((r) => r.models)
export const createModel = (input: ModelCreateInput) =>
  apiPost<{ model: AdminModelDTO }>('/admin/models', input).then((r) => r.model)
export const updateModel = (id: string, input: ModelUpdateInput) =>
  apiPatch<{ ok: true }>(`/admin/models/${id}`, input)
export const reorderModels = (input: ModelReorderInput) =>
  apiPost<{ ok: true }>('/admin/models/reorder', input)
export const deleteModel = (id: string) => apiDelete<{ ok: true }>(`/admin/models/${id}`)

// 邀请码
export const listInvites = () =>
  apiGet<{ invites: InviteCodeDTO[] }>('/admin/invites').then((r) => r.invites)
export const createInvite = (input: InviteCreateInput) =>
  apiPost<{ code: string }>('/admin/invites', input)
export const toggleInvite = (id: string) => apiPatch<{ ok: true }>(`/admin/invites/${id}`)
export const deleteInvite = (id: string) => apiDelete<{ ok: true }>(`/admin/invites/${id}`)

// 用户
export const listUsers = () =>
  apiGet<{ users: AdminUserDTO[] }>('/admin/users').then((r) => r.users)
export const updateUser = (id: string, input: UserUpdateInput) =>
  apiPatch<{ ok: true }>(`/admin/users/${id}`, input)
export const deleteUser = (id: string) => apiDelete<{ ok: true }>(`/admin/users/${id}`)

// 会话（账号中心）
export const getSessions = (userId?: string) =>
  apiGet<{ sessions: AdminSessionDTO[] }>(`/admin/sessions${userId ? `?userId=${userId}` : ''}`).then(
    (r) => r.sessions,
  )
export const revokeSession = (id: string) => apiDelete<{ ok: true }>(`/admin/sessions/${id}`)
export const revokeUserSessions = (userId: string) =>
  apiPost<{ ok: true }>(`/admin/users/${userId}/revoke-sessions`)

// 统计 / 分析 / 事件
export const getStats = () => apiGet<StatsDTO>('/admin/stats')
export const getOverview = (query?: StatsQuery) =>
  apiGet<{ overview: OverviewDTO }>(`/admin/overview${qs(query)}`).then((r) => r.overview)
export const getAnalytics = (query?: StatsQuery) =>
  apiGet<{ analytics: AnalyticsDTO }>(`/admin/analytics${qs(query)}`).then((r) => r.analytics)
export const getUserStats = (query?: StatsQuery) =>
  apiGet<{ users: UserStatDTO[] }>(`/admin/user-stats${qs(query)}`).then((r) => r.users)
export const getUsageEvents = (query?: StatsQuery) =>
  apiGet<Paginated<UsageLogDTO>>(`/admin/usage-events${qs(query)}`)
export const getErrorEvents = (query?: StatsQuery) =>
  apiGet<Paginated<ErrorLogDTO>>(`/admin/error-events${qs(query)}`)
