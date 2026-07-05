import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserSettingsDTO } from '@shared/types/api'
import type { ThemePreference, UserPreferences } from '@shared/types/domain'
import { DEFAULT_PREFERENCES, mergePreferences } from '@shared/util/preferences'
import { updateSettings } from '../api/settings'
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
  /** 是否已用服务端真值 hydrate（用于避免登录后短暂显示缓存值） */
  hydrated: boolean
  hydrate: (dto: UserSettingsDTO) => void
  setTheme: (theme: ThemePreference) => void
  setPreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void
}

async function persistRemote(patch: Parameters<typeof updateSettings>[0]) {
  try {
    await updateSettings(patch)
  } catch {
    toast.error('设置同步失败，请稍后重试')
  }
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set, get) => ({
      theme: 'system',
      preferences: DEFAULT_PREFERENCES,
      hydrated: false,
      hydrate: (dto) => {
        set({ theme: dto.theme, preferences: dto.preferences, hydrated: true })
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
