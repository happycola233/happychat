import type { MessageFontSize, ThemePreference } from '@shared/types/domain'

/** 据主题偏好切换 <html> 的 .dark 类。 */
export function applyTheme(theme: ThemePreference): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

const FONT_CLASSES = ['hc-font-small', 'hc-font-medium', 'hc-font-large'] as const

/** 据字号档位切换 <html> 的 hc-font-* 类（驱动 --hc-msg-font 变量）。 */
export function applyFontSize(size: MessageFontSize): void {
  const el = document.documentElement
  el.classList.remove(...FONT_CLASSES)
  el.classList.add(`hc-font-${size}`)
}
