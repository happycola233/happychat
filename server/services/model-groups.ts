import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { AdminModelGroupDTO, ModelGroupDTO } from '@shared/types/api'
import type {
  ModelGroupCreateInput,
  ModelGroupUpdateInput,
  ModelIconBatchInput,
} from '@shared/schemas/model-group'
import { resolveModelGroupColor } from '@shared/util/modelGroupAppearance'
import { normalizeModelIcon } from '@shared/util/modelIcon'
import { db } from '../db/client'
import { modelGroups, models, modelUserAccess, providers } from '../db/schema'
import { must } from '../lib/assert'
import { modelIconReferencesExist, type DbTransaction } from './model-icon-references'
import { accessJoinForUser, accessibleToUser } from './models'

type ModelGroupRow = typeof modelGroups.$inferSelect
/** DTO 只需要展示字段；列表查询可以只 select 这几列，不必回表取时间戳。 */
type ModelGroupFields = Pick<ModelGroupRow, 'id' | 'name' | 'icon' | 'color' | 'sort'>

export function toModelGroupDTO(g: ModelGroupFields): ModelGroupDTO {
  const icon = normalizeModelIcon(g.icon)
  return {
    id: g.id,
    name: g.name,
    // 图标会被拼进 URL 与 CSS mask，与模型同样在 DTO 边界统一归一化。
    icon,
    color: resolveModelGroupColor(icon, g.color),
    sort: g.sort,
  }
}

/** 管理端分组列表：按 sort 排序，附带组内模型数（含未上架/受限模型）。 */
export async function listAdminModelGroups(): Promise<AdminModelGroupDTO[]> {
  const rows = await db.select().from(modelGroups).orderBy(asc(modelGroups.sort), asc(modelGroups.createdAt))
  const counts = await db
    .select({ groupId: models.groupId, count: sql<number>`count(*)` })
    .from(models)
    .groupBy(models.groupId)
  const countByGroup = new Map(counts.map((row) => [row.groupId, row.count]))
  return rows.map((row) => ({
    ...toModelGroupDTO(row),
    modelCount: countByGroup.get(row.id) ?? 0,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }))
}

/**
 * 用户端可见分组：只返回至少含一条**该用户可见模型**的分组。
 *
 * 可见性判定必须与 `listEnabledModels` 完全一致（模型启用 + 供应商启用 + 访问范围命中），
 * 否则用户会看到点进去是空的分组，或从分组数量反推出自己无权使用的模型的存在。
 */
export async function listVisibleModelGroups(userId: string): Promise<ModelGroupDTO[]> {
  const rows = await db
    .selectDistinct({
      id: modelGroups.id,
      name: modelGroups.name,
      icon: modelGroups.icon,
      color: modelGroups.color,
      sort: modelGroups.sort,
    })
    .from(modelGroups)
    .innerJoin(models, eq(models.groupId, modelGroups.id))
    .innerJoin(providers, eq(models.providerId, providers.id))
    .leftJoin(modelUserAccess, accessJoinForUser(userId))
    .where(and(eq(models.enabled, true), eq(providers.enabled, true), accessibleToUser()))
    .orderBy(asc(modelGroups.sort), asc(modelGroups.name))
  return rows.map(toModelGroupDTO)
}

export async function getModelGroup(id: string): Promise<ModelGroupRow | null> {
  const [row] = await db.select().from(modelGroups).where(eq(modelGroups.id, id)).limit(1)
  return row ?? null
}

export type CreateModelGroupResult =
  | { ok: true; group: AdminModelGroupDTO }
  | { ok: false; code: 'icon_missing' }

export async function createModelGroup(
  input: ModelGroupCreateInput,
): Promise<CreateModelGroupResult> {
  return db.transaction(
    (tx) => {
      if (!modelIconReferencesExist(tx, [input.icon])) {
        return { ok: false, code: 'icon_missing' } as const
      }
      // 新分组排到末尾：取当前最大 sort + 100，沿用模型排序的稀疏步长约定。
      const maxRow = tx
        .select({ max: sql<number | null>`max(${modelGroups.sort})` })
        .from(modelGroups)
        .get()
      const row = must(
        tx
          .insert(modelGroups)
          .values({
            name: input.name,
            icon: input.icon ?? null,
            color: resolveModelGroupColor(input.icon, input.color),
            sort: (maxRow?.max ?? 0) + 100,
          })
          .returning()
          .get(),
      )
      return {
        ok: true,
        group: {
          ...toModelGroupDTO(row),
          modelCount: 0,
          createdAt: row.createdAt.getTime(),
          updatedAt: row.updatedAt.getTime(),
        },
      } as const
    },
    { behavior: 'immediate' },
  )
}

/** 更新分组：undefined=不改动，null=清除图标/颜色。 */
export async function updateModelGroup(
  id: string,
  input: ModelGroupUpdateInput,
): Promise<UpdateModelGroupResult> {
  return db.transaction(
    (tx) => {
      const existing = tx
        .select({ id: modelGroups.id, icon: modelGroups.icon, color: modelGroups.color })
        .from(modelGroups)
        .where(eq(modelGroups.id, id))
        .limit(1)
        .get()
      if (!existing) return { ok: false, code: 'group_missing' } as const
      if (input.icon !== undefined && !modelIconReferencesExist(tx, [input.icon])) {
        return { ok: false, code: 'icon_missing' } as const
      }

      const currentIcon = normalizeModelIcon(existing.icon)
      // 历史 icon+color 组合里的颜色从未真正可见；移除图标时也不能让它意外复活。
      const currentColor = resolveModelGroupColor(currentIcon, existing.color)
      const nextIcon = input.icon !== undefined ? input.icon : currentIcon
      const nextColor = resolveModelGroupColor(
        nextIcon,
        input.color !== undefined ? input.color : currentColor,
      )

      const patch: Partial<typeof modelGroups.$inferInsert> = {}
      if (input.name !== undefined) patch.name = input.name
      if (input.icon !== undefined) patch.icon = input.icon
      if (input.color !== undefined || nextColor !== (existing.color ?? null)) {
        patch.color = nextColor
      }
      const row = tx.update(modelGroups).set(patch).where(eq(modelGroups.id, id)).returning().get()
      return row
        ? ({ ok: true, group: toModelGroupDTO(row) } as const)
        : ({ ok: false, code: 'group_missing' } as const)
    },
    { behavior: 'immediate' },
  )
}

export type UpdateModelGroupResult =
  | { ok: true; group: ModelGroupDTO }
  | { ok: false; code: 'group_missing' | 'icon_missing' }

/**
 * 删除分组：组内模型回到「未分组」，**不会被删除**。
 *
 * 不依赖 FK 的 ON DELETE SET NULL——那会顺带触发 drizzle 的 $onUpdateFn 之外的行为不可控，
 * 且我们需要**保留各模型原有的 updatedAt**（分组变动不该让模型看起来"刚被改过"），
 * 因此逐行显式写回原时间戳，与 `deleteFolder` 处理会话的做法一致。
 */
export async function deleteModelGroup(id: string): Promise<boolean> {
  const group = await getModelGroup(id)
  if (!group) return false
  db.transaction((tx) => {
    const affected = tx
      .select({ id: models.id, updatedAt: models.updatedAt })
      .from(models)
      .where(eq(models.groupId, id))
      .all()
    for (const row of affected) {
      tx.update(models).set({ groupId: null, updatedAt: row.updatedAt }).where(eq(models.id, row.id)).run()
    }
    tx.delete(modelGroups).where(eq(modelGroups.id, id)).run()
  })
  return true
}

export type ReorderModelGroupsResult =
  | { ok: true }
  | { ok: false; code: 'invalid_order'; invalidIds: string[] }

/** 按管理员提交的完整顺序重写分组 sort，语义与 `reorderModels` 一致（要求列表穷尽）。 */
export async function reorderModelGroups(groupIds: string[]): Promise<ReorderModelGroupsResult> {
  const existing = await db.select({ id: modelGroups.id }).from(modelGroups)
  const existingIds = new Set(existing.map((g) => g.id))
  const submittedIds = new Set(groupIds)
  const unknownIds = groupIds.filter((id) => !existingIds.has(id))
  const omittedIds = existing.map((g) => g.id).filter((id) => !submittedIds.has(id))
  if (unknownIds.length || omittedIds.length) {
    return { ok: false, code: 'invalid_order', invalidIds: [...unknownIds, ...omittedIds] }
  }
  db.transaction((tx) => {
    for (const [index, id] of groupIds.entries()) {
      tx.update(modelGroups)
        .set({ sort: (index + 1) * 100 })
        .where(eq(modelGroups.id, id))
        .run()
    }
  })
  return { ok: true }
}

export type AssignModelsResult =
  | { ok: true; moved: number }
  | { ok: false; code: 'group_missing' }
  | { ok: false; code: 'unknown_models'; invalidIds: string[] }

/**
 * 批量把模型移入某分组（groupId=null 为移出分组）。
 *
 * 与 `updateModelAccess` 同样在 IMMEDIATE 事务里先校验后写入：任何一个 id 不存在都整体失败，
 * 不做「能移几个算几个」的部分成功——管理员看到成功提示时名单必须已完整生效。
 * 分组归属不影响模型自身的配置，因此逐行保留原 updatedAt。
 */
export async function assignModelsToGroup(
  groupId: string | null,
  modelIds: string[],
): Promise<AssignModelsResult> {
  return db.transaction(
    (tx) => {
      if (groupId) {
        const group = tx
          .select({ id: modelGroups.id })
          .from(modelGroups)
          .where(eq(modelGroups.id, groupId))
          .limit(1)
          .get()
        if (!group) return { ok: false, code: 'group_missing' } as const
      }
      const found = tx
        .select({ id: models.id, updatedAt: models.updatedAt })
        .from(models)
        .where(inArray(models.id, modelIds))
        .all()
      const foundIds = new Set(found.map((row) => row.id))
      const invalidIds = modelIds.filter((id) => !foundIds.has(id))
      if (invalidIds.length) return { ok: false, code: 'unknown_models', invalidIds } as const

      for (const row of found) {
        tx.update(models).set({ groupId, updatedAt: row.updatedAt }).where(eq(models.id, row.id)).run()
      }
      return { ok: true, moved: found.length } as const
    },
    { behavior: 'immediate' },
  )
}

export type ApplyModelIconsResult =
  | { ok: true; updated: number }
  | { ok: false; code: 'unknown_models'; invalidIds: string[] }
  | { ok: false; code: 'icon_missing' }

/** 批量写入模型图标（管理端「批量识别图标」确认后提交的差异集）。 */
export async function applyModelIcons(
  items: ModelIconBatchInput['items'],
): Promise<ApplyModelIconsResult> {
  return db.transaction(
    (tx) => {
      const ids = items.map((item) => item.id)
      const found = tx
        .select({ id: models.id, updatedAt: models.updatedAt })
        .from(models)
        .where(inArray(models.id, ids))
        .all()
      const updatedAtById = new Map(found.map((row) => [row.id, row.updatedAt]))
      const invalidIds = ids.filter((id) => !updatedAtById.has(id))
      if (invalidIds.length) return { ok: false, code: 'unknown_models', invalidIds } as const
      if (!modelIconReferencesExist(tx, items.map((item) => item.icon))) {
        return { ok: false, code: 'icon_missing' } as const
      }

      for (const item of items) {
        tx.update(models)
          .set({ icon: item.icon, updatedAt: updatedAtById.get(item.id)! })
          .where(eq(models.id, item.id))
          .run()
      }
      return { ok: true, updated: items.length } as const
    },
    { behavior: 'immediate' },
  )
}

/**
 * 某个自定义图标被删除时，把所有引用它的模型/分组图标置空。
 * 图标是 JSON 列，无法靠 FK 级联，必须显式清理，否则前端会一直请求已删除的图标 id。
 */
export function clearCustomIconReferences(tx: DbTransaction, iconId: string): void {
  const modelRows = tx
    .select({ id: models.id, icon: models.icon, updatedAt: models.updatedAt })
    .from(models)
    .all()
  for (const row of modelRows) {
    const icon = normalizeModelIcon(row.icon)
    if (icon?.type === 'custom' && icon.id === iconId) {
      tx.update(models).set({ icon: null, updatedAt: row.updatedAt }).where(eq(models.id, row.id)).run()
    }
  }
  const groupRows = tx
    .select({ id: modelGroups.id, icon: modelGroups.icon, updatedAt: modelGroups.updatedAt })
    .from(modelGroups)
    .all()
  for (const row of groupRows) {
    const icon = normalizeModelIcon(row.icon)
    if (icon?.type === 'custom' && icon.id === iconId) {
      tx.update(modelGroups)
        .set({ icon: null, color: null, updatedAt: row.updatedAt })
        .where(eq(modelGroups.id, row.id))
        .run()
    }
  }
}
