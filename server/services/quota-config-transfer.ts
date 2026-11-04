import { asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { quotaRulesSchema } from '@shared/schemas/quota'
import {
  QUOTA_CONFIG_FORMAT,
  QUOTA_CONFIG_VERSION,
  quotaConfigDocumentSchema,
  quotaConfigPolicySchema,
  type quotaConfigRuleSchema,
  type QuotaConfigRuleEntry,
} from '@shared/schemas/quota-config-transfer'
import type {
  ConfigImportItemDTO,
  ConfigImportPreviewDTO,
  QuotaConfigDocumentDTO,
} from '@shared/types/api'
import type { QuotaRule } from '@shared/types/domain'
import { normalizeQuotaRules } from '@shared/util/quota'
import { db } from '../db/client'
import { modelGroups, models, quotaPolicies } from '../db/schema'
import {
  emptyImportPreview,
  formatIssues,
  runImportTransaction,
  stableJson,
  summarizeImport,
} from '../lib/config-transfer'
import { newId } from '../lib/id'
import { QUOTA_POLICY_SORT_STEP, markDefaultWithin } from './quota-admin'

interface NamedTarget {
  id: string
  name: string
}

interface Catalog {
  models: (NamedTarget & { groupId: string | null })[]
  groups: NamedTarget[]
}

async function loadCatalog(): Promise<Catalog> {
  const [modelRows, groupRows] = await Promise.all([
    db
      .select({ id: models.id, name: models.displayName, groupId: models.groupId })
      .from(models)
      .orderBy(asc(models.sort), asc(models.displayName)),
    db
      .select({ id: modelGroups.id, name: modelGroups.name })
      .from(modelGroups)
      .orderBy(asc(modelGroups.sort), asc(modelGroups.name)),
  ])
  return { models: modelRows, groups: groupRows }
}

/** 名称唯一时导出名称（便于人和 AI 阅读），重名时退回 ID。 */
function referenceOf(target: NamedTarget, all: readonly NamedTarget[]): string {
  return all.filter((item) => item.name === target.name).length === 1 ? target.name : target.id
}

function resolveReference(
  reference: string,
  all: readonly NamedTarget[],
  noun: string,
): { id: string } | { error: string } {
  if (all.some((item) => item.id === reference)) return { id: reference }
  const byName = all.filter((item) => item.name === reference)
  if (byName.length === 1) return { id: byName[0]!.id }
  return {
    error:
      byName.length > 1
        ? `${noun}名称「${reference}」不唯一，请改用 ID`
        : `找不到${noun}「${reference}」`,
  }
}

/** 规则 → 文档条目；已删除目标的引用不再导出（它们本就不参与计量）。 */
function exportRule(rule: QuotaRule, catalog: Catalog): QuotaConfigRuleEntry {
  const references = (ids: string[], all: readonly NamedTarget[]) =>
    ids.flatMap((id) => {
      const target = all.find((item) => item.id === id)
      return target ? [referenceOf(target, all)] : []
    })
  return {
    id: rule.id,
    label: rule.label,
    scope:
      rule.scope.type === 'all'
        ? { type: 'all' }
        : rule.scope.type === 'models'
          ? {
              type: 'models',
              models: references(rule.scope.modelIds, catalog.models),
              mode: rule.scope.mode,
            }
          : {
              type: 'groups',
              groups: references(rule.scope.groupIds, catalog.groups),
              mode: rule.scope.mode,
            },
    metric: rule.metric,
    ...(rule.currency ? { currency: rule.currency } : {}),
    limit: rule.limit,
    window: rule.window,
    priority: rule.priority,
  }
}

/** 导出额度策略（不含用户绑定与用量）；ids 省略时导出全部策略。 */
export async function exportQuotaConfig(ids?: string[]): Promise<QuotaConfigDocumentDTO> {
  const [rows, catalog] = await Promise.all([
    db.select().from(quotaPolicies).orderBy(asc(quotaPolicies.sort), asc(quotaPolicies.createdAt)),
    loadCatalog(),
  ])
  const groupNames = new Map(catalog.groups.map((group) => [group.id, group.name]))
  return {
    format: QUOTA_CONFIG_FORMAT,
    version: QUOTA_CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    models: catalog.models.map((model) => ({
      id: model.id,
      name: model.name,
      group: model.groupId ? (groupNames.get(model.groupId) ?? null) : null,
    })),
    groups: catalog.groups,
    policies: (ids ? rows.filter((row) => ids.includes(row.id)) : rows).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isDefault: row.isDefault,
      rules: normalizeQuotaRules(row.rules).map((rule) => exportRule(rule, catalog)),
    })),
  }
}

type ParsedRuleEntry = z.output<typeof quotaConfigRuleSchema>

/** 文档规则 → 待校验的正式规则：解析模型 / 分组引用，缺 id 的规则生成新 id。 */
function resolveRule(
  entry: ParsedRuleEntry,
  index: number,
  catalog: Catalog,
): { rule: unknown; errors: string[] } {
  const errors: string[] = []
  const resolveAll = (references: string[], all: readonly NamedTarget[], field: string) => {
    const ids: string[] = []
    references.forEach((reference, refIndex) => {
      const resolved = resolveReference(reference, all, field === 'models' ? '模型' : '分组')
      if ('error' in resolved)
        errors.push(`rules.${index}.scope.${field}.${refIndex}：${resolved.error}`)
      // 同一目标既写了名称又写了 ID 时只算一次。
      else if (!ids.includes(resolved.id)) ids.push(resolved.id)
    })
    return ids
  }
  const scope =
    entry.scope.type === 'all'
      ? { type: 'all' as const }
      : entry.scope.type === 'models'
        ? {
            type: 'models' as const,
            modelIds: resolveAll(entry.scope.models, catalog.models, 'models'),
            mode: entry.scope.mode,
          }
        : {
            type: 'groups' as const,
            groupIds: resolveAll(entry.scope.groups, catalog.groups, 'groups'),
            mode: entry.scope.mode,
          }
  if (!entry.window && entry.limit.kind !== 'unlimited')
    errors.push(`rules.${index}.window：请填写统计周期`)
  return {
    errors,
    rule: {
      id: entry.id ?? newId(),
      label: entry.label ?? null,
      scope,
      metric: entry.metric,
      ...(entry.currency ? { currency: entry.currency } : {}),
      limit: entry.limit,
      window: entry.window ?? { type: 'total' },
      priority: entry.priority,
    },
  }
}

function rawPolicyLabel(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { name } = raw as Record<string, unknown>
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/**
 * 预览或应用一份额度策略文档。全部条目在同一个 IMMEDIATE 事务里按顺序执行：
 * 任一条出错则整份回滚；预览无论结果如何都回滚。只新建或更新策略，不删除、不改用户绑定。
 */
export async function importQuotaConfig(
  document: unknown,
  mode: 'preview' | 'apply',
): Promise<ConfigImportPreviewDTO> {
  const parsedDocument = quotaConfigDocumentSchema.safeParse(document)
  if (!parsedDocument.success) return emptyImportPreview(formatIssues(parsedDocument.error))
  const rawEntries = parsedDocument.data.policies
  const catalog = await loadCatalog()

  return runImportTransaction((tx) => {
    const policies = tx.select().from(quotaPolicies).all()
    let nextSort = Math.max(0, ...policies.map((policy) => policy.sort)) + QUOTA_POLICY_SORT_STEP
    const entries = rawEntries.map((raw) => quotaConfigPolicySchema.safeParse(raw))
    const defaultRequests = entries.filter(
      (entry) => entry.success && entry.data.isDefault === true,
    ).length
    const seenPolicyIds = new Set<string>()
    // 放在对象里：回调中的赋值不会被外层控制流分析看到。
    const defaultChange: { target: { id: string; label: string } | null } = { target: null }

    const items = entries.map((entry, index): ConfigImportItemDTO => {
      const item: ConfigImportItemDTO = {
        index,
        action: 'error',
        id: null,
        label: `第 ${index + 1} 个策略`,
        changes: [],
        errors: [],
        notes: [],
      }
      if (!entry.success) {
        item.label = rawPolicyLabel(rawEntries[index]) ?? item.label
        item.errors = formatIssues(entry.error)
        return item
      }
      const { id, name, isDefault, rules: ruleEntries } = entry.data
      const description =
        entry.data.description === undefined ? undefined : entry.data.description || null

      let existing = id ? policies.find((policy) => policy.id === id) : undefined
      if (id && !existing) item.notes.push('未找到该 ID 的策略，将新建')
      if (!id && name) {
        const sameName = policies.filter((policy) => policy.name === name)
        if (sameName.length > 1) item.errors.push(`有多个名为「${name}」的策略，请写 id 区分`)
        else if (sameName[0]) {
          existing = sameName[0]
          item.notes.push('按名称匹配到已有策略')
        }
      }
      item.label = name ?? existing?.name ?? item.label
      if (existing) {
        if (seenPolicyIds.has(existing.id)) item.errors.push('同一策略在文档中出现了多次')
        seenPolicyIds.add(existing.id)
      }
      if (!existing && !name) item.errors.push('新建策略必须填写 name')
      if (isDefault && defaultRequests > 1) item.errors.push('整份文档只能把一个策略设为默认')
      if (isDefault === false && existing?.isDefault && defaultRequests === 0)
        item.errors.push('必须保留一个默认策略：请把另一个策略设为默认')

      let rules: QuotaRule[] | undefined
      if (ruleEntries) {
        const resolved = ruleEntries.map((rule, ruleIndex) => resolveRule(rule, ruleIndex, catalog))
        const referenceErrors = resolved.flatMap((rule) => rule.errors)
        item.errors.push(...referenceErrors)
        // 引用没解析出来时不再报「请选择至少一个模型」这类连带错误。
        if (referenceErrors.length === 0) {
          const parsedRules = quotaRulesSchema.safeParse(resolved.map((rule) => rule.rule))
          if (parsedRules.success) rules = parsedRules.data
          else item.errors.push(...formatIssues(parsedRules.error, 'rules'))
        }
        const withoutId = ruleEntries.filter((rule) => !rule.id).length
        if (existing && withoutId > 0 && normalizeQuotaRules(existing.rules).length > 0)
          item.notes.push(
            `${withoutId} 条规则没有 id，将作为新规则保存，用户对原规则的单独调整与临时额度不会沿用`,
          )
      }
      if (item.errors.length > 0) return item

      if (existing) {
        item.id = existing.id
        if (name !== undefined && name !== existing.name) item.changes.push('名称')
        if (description !== undefined && description !== existing.description)
          item.changes.push('备注')
        if (rules && stableJson(rules) !== stableJson(normalizeQuotaRules(existing.rules)))
          item.changes.push('规则')
        if (isDefault && !existing.isDefault) item.changes.push('设为默认')
        if (item.changes.length === 0) {
          item.action = 'unchanged'
          return item
        }
        tx.update(quotaPolicies)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(rules ? { rules } : {}),
            updatedAt: new Date(),
          })
          .where(eq(quotaPolicies.id, existing.id))
          .run()
        item.action = 'update'
      } else {
        item.id = newId()
        tx.insert(quotaPolicies)
          .values({
            id: item.id,
            name: name!,
            description: description ?? null,
            rules: rules ?? [],
            isDefault: false,
            sort: nextSort,
          })
          .run()
        nextSort += QUOTA_POLICY_SORT_STEP
        item.action = 'create'
        item.changes = ['新建策略']
      }
      if (isDefault && !existing?.isDefault)
        defaultChange.target = { id: item.id, label: item.label }
      return item
    })

    const notices: string[] = []
    if (defaultChange.target) {
      markDefaultWithin(tx, defaultChange.target.id)
      notices.push(`设为默认策略：${defaultChange.target.label}`)
    }
    return summarizeImport(items, notices, mode)
  })
}
