import type { QueryKey } from '@tanstack/react-query'
import type { ConfigImportPreviewDTO } from '@shared/types/api'
import { MODEL_CONFIG_AI_GUIDE } from '@shared/schemas/model-config-transfer'
import { QUOTA_CONFIG_AI_GUIDE } from '@shared/schemas/quota-config-transfer'
import * as adminApi from '../../api/admin'
/** 一类可导入导出的配置：文案、接口与导入后需要刷新的数据。 */
export interface ConfigTransferKind {
  title: string
  /** 条目名词，用于提示，如「模型」「策略」 */
  noun: string
  exportNote: string
  aiExample: string
  aiGuide: string
  filePrefix: string
  placeholder: string
  exportDocument: (ids?: string[]) => Promise<unknown>
  previewImport: (document: unknown) => Promise<ConfigImportPreviewDTO>
  applyImport: (document: unknown) => Promise<ConfigImportPreviewDTO>
  invalidateKeys: QueryKey[]
}

export const MODEL_CONFIG_TRANSFER: ConfigTransferKind = {
  title: '导入 / 导出模型配置',
  noun: '模型',
  exportNote:
    '导出包含模型参数、提示词、用户计价、线路与成本价，不包含 API Key 和用户名单。修改后可在「导入」中预览并应用；只保留需要修改的模型与字段即可，未写出的字段保持不变。',
  aiExample: '按官网最新价格更新定价',
  aiGuide: MODEL_CONFIG_AI_GUIDE,
  filePrefix: 'happychat-models',
  placeholder:
    '粘贴导出的或 AI 生成的配置，例如：\n{"format":"happychat-model-config","version":1,"models":[{"id":"…","pricing":{"input":1.25,"output":10}}]}',
  exportDocument: adminApi.exportModelConfig,
  previewImport: adminApi.previewModelConfigImport,
  applyImport: adminApi.applyModelConfigImport,
  invalidateKeys: [
    ['admin', 'models'],
    ['admin', 'model-groups'],
    ['admin', 'providers'],
    ['models'],
  ],
}

export const QUOTA_CONFIG_TRANSFER: ConfigTransferKind = {
  title: '导入 / 导出额度策略',
  noun: '策略',
  exportNote:
    '导出包含策略名称、默认策略与全部规则，不包含用户名单、用户的单独调整与用量。修改后可在「导入」中预览并应用；只保留需要修改的策略与字段即可，未写出的字段保持不变。',
  aiExample: '新增一个每月 $10、每天最多生图 20 张的「入门」策略',
  aiGuide: QUOTA_CONFIG_AI_GUIDE,
  filePrefix: 'happychat-quota',
  placeholder:
    '粘贴导出的或 AI 生成的配置，例如：\n{"format":"happychat-quota-config","version":1,"policies":[{"name":"VIP","rules":[]}]}',
  exportDocument: adminApi.exportQuotaConfig,
  previewImport: adminApi.previewQuotaConfigImport,
  applyImport: adminApi.applyQuotaConfigImport,
  invalidateKeys: [
    ['admin', 'quota'],
    ['quota', 'me'],
  ],
}
