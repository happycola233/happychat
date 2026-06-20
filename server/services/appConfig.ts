import { eq } from 'drizzle-orm'
import type { AppConfigDTO } from '@shared/types/api'
import type { AppConfigUpdateInput } from '@shared/schemas/app-config'
import { db } from '../db/client'
import { appSettings } from '../db/schema'

type AppSettingsRow = typeof appSettings.$inferSelect

/** 取（或创建）全局设置单例行。 */
async function ensureRow(): Promise<AppSettingsRow> {
  const [row] = await db.select().from(appSettings).limit(1)
  if (row) return row
  const [created] = await db.insert(appSettings).values({}).returning()
  return created!
}

function toDTO(row: AppSettingsRow): AppConfigDTO {
  return {
    sharingEnabled: row.sharingEnabled,
    titleEnabled: row.titleEnabled,
    titleModelId: row.titleModelId,
    titlePrompt: row.titlePrompt,
  }
}

export async function getAppConfig(): Promise<AppConfigDTO> {
  return toDTO(await ensureRow())
}

export async function updateAppConfig(patch: AppConfigUpdateInput): Promise<AppConfigDTO> {
  const row = await ensureRow()
  const set: Partial<typeof appSettings.$inferInsert> = { updatedAt: new Date() }
  if (patch.sharingEnabled !== undefined) set.sharingEnabled = patch.sharingEnabled
  if (patch.titleEnabled !== undefined) set.titleEnabled = patch.titleEnabled
  if (patch.titleModelId !== undefined) set.titleModelId = patch.titleModelId
  if (patch.titlePrompt !== undefined) set.titlePrompt = patch.titlePrompt
  await db.update(appSettings).set(set).where(eq(appSettings.id, row.id))
  return getAppConfig()
}
