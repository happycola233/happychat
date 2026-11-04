import type { z } from 'zod'
import type { ConfigImportAction, ConfigImportPreviewDTO } from '@shared/types/api'
import { db } from '../db/client'

type ImportTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * 模型配置与额度策略导入共用的工具：差异比较、错误文案与「预览即回滚」。
 */

/** 键顺序无关的 JSON 比较；undefined 与 null 视为同一个「未设置」。 */
export function stableJson(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** zod 错误 → 带字段路径的中文文案；未知字段多半是拼写错误，直接点名。 */
export function formatIssues(error: z.ZodError, prefix = ''): string[] {
  return error.issues.map((issue) => {
    const path = [prefix, ...issue.path.map(String)].filter(Boolean).join('.')
    const message =
      issue.code === 'unrecognized_keys' ? `不支持的字段：${issue.keys.join('、')}` : issue.message
    return path ? `${path}：${message}` : message
  })
}

/** 预览在同一事务里完整执行导入后回滚，保证预览与实际导入的校验逐字一致。 */
class PreviewRollback extends Error {
  constructor(readonly preview: ConfigImportPreviewDTO) {
    super('config import preview rollback')
  }
}

export function emptyImportPreview(documentErrors: string[]): ConfigImportPreviewDTO {
  return {
    valid: documentErrors.length === 0,
    applied: false,
    documentErrors,
    notices: [],
    items: [],
    summary: { create: 0, update: 0, unchanged: 0, error: 0 },
  }
}

/** 汇总条目结果；无错误且为应用模式时才算已提交。 */
export function summarizeImport(
  items: ConfigImportPreviewDTO['items'],
  notices: string[],
  mode: 'preview' | 'apply',
): ConfigImportPreviewDTO {
  const summary: Record<ConfigImportAction, number> = {
    create: 0,
    update: 0,
    unchanged: 0,
    error: 0,
  }
  for (const item of items) summary[item.action] += 1
  return {
    valid: summary.error === 0,
    applied: mode === 'apply' && summary.error === 0,
    documentErrors: [],
    notices,
    items,
    summary,
  }
}

/**
 * 在一个 IMMEDIATE 事务里按顺序执行整份导入：未提交（预览或有任何错误）就整份回滚并返回结果。
 * 预览中新建对象的 ID 在回滚后不存在，不能交给界面当作可跳转的对象。
 */
export function runImportTransaction(
  run: (tx: ImportTransaction) => ConfigImportPreviewDTO,
): ConfigImportPreviewDTO {
  try {
    return db.transaction(
      (tx) => {
        const preview = run(tx)
        if (!preview.applied) throw new PreviewRollback(preview)
        return preview
      },
      { behavior: 'immediate' },
    )
  } catch (error) {
    if (error instanceof PreviewRollback) {
      for (const item of error.preview.items) if (item.action === 'create') item.id = null
      return error.preview
    }
    throw error
  }
}
