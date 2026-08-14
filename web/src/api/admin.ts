import type {
  AdminPasswordResetResult,
  AdminModelDTO,
  AdminModelGroupDTO,
  AdminQuotaPolicyDTO,
  AdminUserQuotaDTO,
  AdminUserQuotaDetailDTO,
  CustomIconDTO,
  QuotaAdjustmentDTO,
  QuotaPreviewDTO,
  ModelAccessDTO,
  ModelGroupDTO,
  AdminSessionDTO,
  AdminUserDTO,
  AnalyticsDTO,
  ErrorLogDTO,
  ImportModelsResult,
  InviteCodeDTO,
  OverviewDTO,
  Paginated,
  ProviderDetailDTO,
  ProviderDTO,
  ProviderTestResult,
  StatsDTO,
  SyncModelsResult,
  UpstreamCatalogModelDTO,
  UsageLogDTO,
  UserStatDTO,
} from '@shared/types/api'
import type {
  ModelCreateInput,
  ModelAccessUpdateInput,
  ModelImportInput,
  ModelReorderInput,
  ModelUpdateInput,
  ProviderCreateInput,
  ProviderUpdateInput,
} from '@shared/schemas/model-config'
import type {
  ModelGroupAssignInput,
  ModelGroupCreateInput,
  ModelGroupReorderInput,
  ModelGroupUpdateInput,
  ModelIconBatchInput,
} from '@shared/schemas/model-group'
import type { InviteCreateInput, UserUpdateInput } from '@shared/schemas/admin'
import type {
  QuotaBatchAssignInput,
  QuotaGrantCreateInput,
  QuotaPolicyCreateInput,
  QuotaPolicyReorderInput,
  QuotaPolicyUpdateInput,
  QuotaPreviewInput,
  QuotaResetInput,
  UserQuotaUpdateInput,
} from '@shared/schemas/quota'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload } from './client'

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
export const getProviderCatalog = (id: string) =>
  apiGet<{ models: UpstreamCatalogModelDTO[] }>(`/admin/providers/${id}/catalog`).then(
    (r) => r.models,
  )
export const importProviderModels = (id: string, input: ModelImportInput) =>
  apiPost<ImportModelsResult>(`/admin/providers/${id}/import-models`, input)

export const listAdminModels = () =>
  apiGet<{ models: AdminModelDTO[] }>('/admin/models').then((r) => r.models)
export const createModel = (input: ModelCreateInput) =>
  apiPost<{ model: AdminModelDTO }>('/admin/models', input).then((r) => r.model)
export const updateModel = (id: string, input: ModelUpdateInput) =>
  apiPatch<{ ok: true }>(`/admin/models/${id}`, input)
export const reorderModels = (input: ModelReorderInput) =>
  apiPost<{ ok: true }>('/admin/models/reorder', input)
export const deleteModel = (id: string) => apiDelete<{ ok: true }>(`/admin/models/${id}`)
export const getModelAccess = (id: string) => apiGet<ModelAccessDTO>(`/admin/models/${id}/access`)
export const updateModelAccess = (id: string, input: ModelAccessUpdateInput) =>
  apiPut<{ ok: true }>(`/admin/models/${id}/access`, input)
export const applyModelIcons = (input: ModelIconBatchInput) =>
  apiPost<{ ok: true; updated: number }>('/admin/models/icons/batch', input)

// 模型分组
export const listAdminModelGroups = () =>
  apiGet<{ groups: AdminModelGroupDTO[] }>('/admin/model-groups').then((r) => r.groups)
export const createModelGroup = (input: ModelGroupCreateInput) =>
  apiPost<{ group: AdminModelGroupDTO }>('/admin/model-groups', input).then((r) => r.group)
export const updateModelGroup = (id: string, input: ModelGroupUpdateInput) =>
  apiPatch<{ group: ModelGroupDTO }>(`/admin/model-groups/${id}`, input).then((r) => r.group)
export const deleteModelGroup = (id: string) => apiDelete<{ ok: true }>(`/admin/model-groups/${id}`)
export const reorderModelGroups = (input: ModelGroupReorderInput) =>
  apiPost<{ ok: true }>('/admin/model-groups/reorder', input)
export const assignModelsToGroup = (input: ModelGroupAssignInput) =>
  apiPost<{ ok: true; moved: number }>('/admin/model-groups/assign', input)

// 自定义图标库
export const listCustomIcons = () =>
  apiGet<{ icons: CustomIconDTO[] }>('/admin/model-icons/custom').then((r) => r.icons)
export const uploadCustomIcon = (file: File, name: string) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name)
  return apiUpload<{ icon: CustomIconDTO }>('/admin/model-icons/custom', formData).then(
    (r) => r.icon,
  )
}
export const deleteCustomIcon = (id: string) =>
  apiDelete<{ ok: true }>(`/admin/model-icons/custom/${id}`)

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
export const resetUserPassword = (id: string) =>
  apiPost<AdminPasswordResetResult>(`/admin/users/${id}/reset-password`)

// 会话（账号中心）
export const getSessions = (userId?: string) =>
  apiGet<{ sessions: AdminSessionDTO[] }>(
    `/admin/sessions${userId ? `?userId=${userId}` : ''}`,
  ).then((r) => r.sessions)
export const revokeSession = (id: string) => apiDelete<{ ok: true }>(`/admin/sessions/${id}`)
export const revokeUserSessions = (userId: string) =>
  apiPost<{ ok: true }>(`/admin/users/${userId}/revoke-sessions`)

// 用户限额
export const listQuotaPolicies = () =>
  apiGet<{ policies: AdminQuotaPolicyDTO[] }>('/admin/quota/policies').then((r) => r.policies)
export const createQuotaPolicy = (input: QuotaPolicyCreateInput) =>
  apiPost<{ policy: AdminQuotaPolicyDTO }>('/admin/quota/policies', input).then((r) => r.policy)
export const updateQuotaPolicy = (id: string, input: QuotaPolicyUpdateInput) =>
  apiPatch<{ policy: AdminQuotaPolicyDTO }>(`/admin/quota/policies/${id}`, input).then(
    (r) => r.policy,
  )
export const deleteQuotaPolicy = (id: string) =>
  apiDelete<{ ok: true; releasedUsers: number }>(`/admin/quota/policies/${id}`)
export const duplicateQuotaPolicy = (id: string) =>
  apiPost<{ policy: AdminQuotaPolicyDTO }>(`/admin/quota/policies/${id}/duplicate`).then(
    (r) => r.policy,
  )
export const setDefaultQuotaPolicy = (id: string) =>
  apiPost<{ ok: true }>(`/admin/quota/policies/${id}/default`)
export const reorderQuotaPolicies = (input: QuotaPolicyReorderInput) =>
  apiPost<{ ok: true }>('/admin/quota/policies/reorder', input)

export const listUserQuotas = () =>
  apiGet<{ users: AdminUserQuotaDTO[] }>('/admin/quota/users').then((r) => r.users)
export const getUserQuotaDetail = (userId: string, days?: number) =>
  apiGet<{ detail: AdminUserQuotaDetailDTO }>(
    `/admin/quota/users/${userId}${days ? `?days=${days}` : ''}`,
  ).then((r) => r.detail)
export const updateUserQuota = (userId: string, input: UserQuotaUpdateInput) =>
  apiPut<{ ok: true }>(`/admin/quota/users/${userId}`, input)
export const batchAssignQuotaPolicy = (input: QuotaBatchAssignInput) =>
  apiPost<{ ok: true; updated: number }>('/admin/quota/users/batch-assign', input)
export const resetUserQuotaPeriod = (userId: string, input: QuotaResetInput) =>
  apiPost<{ ok: true; resetRules: number }>(`/admin/quota/users/${userId}/reset`, input)
export const createUserQuotaGrant = (userId: string, input: QuotaGrantCreateInput) =>
  apiPost<{ grant: QuotaAdjustmentDTO }>(`/admin/quota/users/${userId}/grants`, input).then(
    (r) => r.grant,
  )
export const revokeQuotaAdjustment = (id: string) =>
  apiDelete<{ ok: true }>(`/admin/quota/grants/${id}`)
export const previewUserQuota = (input: QuotaPreviewInput) =>
  apiPost<{ preview: QuotaPreviewDTO }>('/admin/quota/preview', input).then((r) => r.preview)

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
