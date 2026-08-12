import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PublicUser, UserSettingsDTO } from '@shared/types/api'
import type { ThemePreference, UserPreferences } from '@shared/types/domain'
import { DEFAULT_PREFERENCES, mergePreferences } from '@shared/util/preferences'
import { ApiRequestError } from '../api/client'
import { updateSettings } from '../api/settings'
import { queryClient } from '../lib/queryClient'
import { applyAccentColor, applyFontSize, applyTheme } from '../lib/theme'
import { toast } from './toast'

/**
 * 账户级设置：服务端为源，localStorage 仅作首屏缓存（避免主题/字号闪烁）。
 * 登录后由 useSettingsSync 拉取服务端真值并 hydrate 覆盖；改动即时应用并回写服务端。
 * 注意区别于 store/chat.ts 的编排器临时态（选中模型/联网/思考/图片选项）。
 */
interface SettingsStore {
  theme: ThemePreference
  preferences: UserPreferences
  hydrate: (dto: UserSettingsDTO) => void
  setTheme: (theme: ThemePreference) => void
  setPreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void
}

async function persistRemote(patch: Parameters<typeof updateSettings>[0]) {
  // 登录 / 注册页也能切主题，但那时没有账号可写：偏好只留在 localStorage，
  // 明知会 401 的请求就不发了（登录后由服务端真值覆盖本地缓存）。
  const currentUser = queryClient.getQueryData<PublicUser>(['me'])
  if (!currentUser || currentUser.mustChangePassword) return
  try {
    await updateSettings(patch)
  } catch (error) {
    // 会话在页面停留期间过期时同样按“仅本地保存”处理，不用一个同步失败的红条打扰用户。
    if (error instanceof ApiRequestError && error.status === 401) return
    toast.error('设置同步失败，请稍后重试')
  }
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set, get) => ({
      theme: 'system',
      preferences: DEFAULT_PREFERENCES,
      hydrate: (dto) => {
        set({ theme: dto.theme, preferences: dto.preferences })
        applyTheme(dto.theme)
        applyFontSize(dto.preferences.messageFontSize)
        applyAccentColor(dto.preferences.accentColor)
      },
      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
        void persistRemote({ theme })
      },
      setPreference: (key, value) => {
        const preferences = { ...get().preferences, [key]: value }
        set({ preferences })
        if (key === 'messageFontSize') applyFontSize(preferences.messageFontSize)
        if (key === 'accentColor') applyAccentColor(preferences.accentColor)
        void persistRemote({ preferences: { [key]: value } as Partial<UserPreferences> })
      },
    }),
    {
      name: 'happychat-settings',
      partialize: (s) => ({ theme: s.theme, preferences: s.preferences }),
      // 合并缓存时把偏好补全为完整对象，丢弃旧版本遗留键。
      merge: (persisted, current) => {
        const p = persisted as Partial<Pick<SettingsStore, 'theme' | 'preferences'>> | undefined
        return {
          ...current,
          theme: p?.theme ?? current.theme,
          preferences: mergePreferences(p?.preferences),
        }
      },
      // 首屏：用本地缓存即时应用主题与字号，避免闪烁（服务端真值随后覆盖）。
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme)
          applyFontSize(state.preferences.messageFontSize)
          applyAccentColor(state.preferences.accentColor)
        }
      },
    },
  ),
)
