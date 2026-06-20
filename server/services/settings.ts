import { eq } from 'drizzle-orm'
import type { UserSettingsDTO } from '@shared/types/api'
import type { ThemePreference, UserPreferences } from '@shared/types/domain'
import { mergePreferences } from '@shared/util/preferences'
import { db } from '../db/client'
import { userSettings } from '../db/schema'

/** 读取用户设置；缺失项以默认值补全。 */
export async function getUserSettings(userId: string): Promise<UserSettingsDTO> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1)
  return {
    theme: row?.theme ?? 'system',
    preferences: mergePreferences(row?.preferences),
  }
}

export interface SettingsPatch {
  theme?: ThemePreference
  preferences?: Partial<UserPreferences>
}

/** 局部更新用户设置（在当前值上合并），返回更新后的完整设置。 */
export async function updateUserSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<UserSettingsDTO> {
  const current = await getUserSettings(userId)
  const theme = patch.theme ?? current.theme
  const preferences = patch.preferences
    ? mergePreferences({ ...current.preferences, ...patch.preferences })
    : current.preferences

  await db
    .insert(userSettings)
    .values({ userId, theme, preferences })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { theme, preferences, updatedAt: new Date() },
    })

  return { theme, preferences }
}
