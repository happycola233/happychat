import type { MessageFontSize, ThemePreference } from '@shared/types/domain'

let currentThemePreference: ThemePreference = 'system'
let forcedSystemThemeCount = 0

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveDark(theme: ThemePreference): boolean {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark())
}

function applyActiveTheme(): void {
  const activeTheme = forcedSystemThemeCount > 0 ? 'system' : currentThemePreference
  const dark = resolveDark(activeTheme)
  document.documentElement.classList.toggle('dark', dark)
}

/** 据主题偏好切换 <html> 的 .dark 类。 */
export function applyTheme(theme: ThemePreference): void {
  currentThemePreference = theme
  applyActiveTheme()
}

/** 系统主题变化时重新计算当前应该启用的主题。 */
export function refreshTheme(): void {
  applyActiveTheme()
}

/** 公开分享页不读取用户偏好，挂载期间临时强制跟随系统主题。 */
export function forceSystemTheme(): () => void {
  forcedSystemThemeCount += 1
  applyActiveTheme()

  let released = false
  return () => {
    if (released) return
    released = true
    forcedSystemThemeCount = Math.max(0, forcedSystemThemeCount - 1)
    applyActiveTheme()
  }
}

const FONT_CLASSES = ['hc-font-small', 'hc-font-medium', 'hc-font-large'] as const

/** 据字号档位切换 <html> 的 hc-font-* 类（驱动 --hc-msg-font 变量）。 */
export function applyFontSize(size: MessageFontSize): void {
  const el = document.documentElement
  el.classList.remove(...FONT_CLASSES)
  el.classList.add(`hc-font-${size}`)
}
