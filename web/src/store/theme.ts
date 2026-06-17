import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'system' | 'light' | 'dark'

interface ThemeStore {
  theme: Theme
  setTheme: (t: Theme) => void
}

export const useTheme = create<ThemeStore>()(
  persist((set) => ({ theme: 'system', setTheme: (t) => set({ theme: t }) }), {
    name: 'happychat-theme',
  }),
)

export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
