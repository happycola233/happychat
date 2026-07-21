import type { AppConfigDTO } from '@shared/types/api'
import type { AppConfigUpdateInput } from '@shared/schemas/app-config'
import { apiGet, apiPatch } from './client'

/** 读取管理员可配置的全局应用策略。 */
export const getAppConfig = () =>
  apiGet<{ config: AppConfigDTO }>('/admin/app-config').then((response) => response.config)

/** 部分更新全局应用策略，并返回服务端持久化后的完整配置。 */
export const updateAppConfig = (input: AppConfigUpdateInput) =>
  apiPatch<{ config: AppConfigDTO }>('/admin/app-config', input).then((response) => response.config)
