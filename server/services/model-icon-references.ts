import { inArray } from 'drizzle-orm'
import type { ModelGroupIcon, ModelIcon } from '@shared/types/domain'
import type { DB } from '../db/client'
import { modelIcons } from '../db/schema'
import { isKnownLobeIconSlug } from './lobe-icons'

export type DbTransaction = Parameters<Parameters<DB['transaction']>[0]>[0]

/**
 * 校验图标引用指向当前真实存在的资源。字符集安全由共享 schema 负责；这里补上只有
 * 服务端才知道的 lobe 目录与自定义图标库存在性，并支持批量时一次查询全部 custom id。
 */
export function modelIconReferencesExist(
  tx: DbTransaction,
  icons: readonly (ModelGroupIcon | ModelIcon | null | undefined)[],
): boolean {
  const configured = icons.filter(
    (icon): icon is ModelGroupIcon | ModelIcon => icon !== null && icon !== undefined,
  )
  if (configured.some((icon) => icon.type === 'lobe' && !isKnownLobeIconSlug(icon.slug))) {
    return false
  }

  const customIds = [
    ...new Set(configured.filter((icon) => icon.type === 'custom').map((icon) => icon.id)),
  ]
  if (customIds.length === 0) return true

  const found = tx
    .select({ id: modelIcons.id })
    .from(modelIcons)
    .where(inArray(modelIcons.id, customIds))
    .all()
  return found.length === customIds.length
}
