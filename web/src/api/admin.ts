import type {
  AdminModelDTO,
  AdminUserDTO,
  ErrorLogDTO,
  InviteCodeDTO,
  ProviderDetailDTO,
  ProviderDTO,
  ProviderTestResult,
  StatsDTO,
  SyncModelsResult,
  UsageLogDTO,
} from '@shared/types/api'
import type {
  ModelUpdateInput,
  ProviderCreateInput,
  ProviderUpdateInput,
} from '@shared/schemas/model-config'
import type { InviteCreateInput, UserUpdateInput } from '@shared/schemas/admin'
import { apiDelete, apiGet, apiPatch, apiPost } from './client'

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
export const updateModel = (id: string, input: ModelUpdateInput) =>
  apiPatch<{ ok: true }>(`/admin/models/${id}`, input)
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

// 统计 / 日志
export const getStats = () => apiGet<StatsDTO>('/admin/stats')
export const getErrorLogs = () =>
  apiGet<{ logs: ErrorLogDTO[] }>('/admin/error-logs').then((r) => r.logs)
export const getUsageLogs = () =>
  apiGet<{ logs: UsageLogDTO[] }>('/admin/usage-logs').then((r) => r.logs)
