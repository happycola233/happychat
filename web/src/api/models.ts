import type { LobeIconCatalogDTO, ModelDTO, ModelGroupDTO } from '@shared/types/api'
import { apiGet } from './client'

export interface ModelListResult {
  models: ModelDTO[]
  groups: ModelGroupDTO[]
}

/** 模型与分组同一份响应返回，避免选择器出现「模型已到、分组未到」的一帧无分组闪烁。 */
export const listModels = () => apiGet<ModelListResult>('/models')

/** 内置图标目录（含 mono 标记）；随包版本走 ETag，客户端可长期缓存。 */
export const listLobeIcons = () => apiGet<LobeIconCatalogDTO>('/model-icons/catalog')
