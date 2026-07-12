import type { AccentColor, UserPreferences } from '../types/domain'

export const ACCENT_COLORS = [
  'default',
  'blue',
  'green',
  'yellow',
  'pink',
  'orange',
  'purple',
] as const satisfies readonly AccentColor[]

/** 账户级偏好的默认值，前后端共用以保证一致。 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  autoScrollOnOpen: true,
  showScrollToBottom: true,
  showTimelineNav: true,
  showNewChatGradientGlow: true,
  sendOnEnterDesktop: true,
  sendOnEnterMobile: false,
  defaultExpandReasoning: true,
  accentColor: 'default',
  messageFontSize: 'medium',
  showMessageTime: true,
  messageTimeFormat: 'datetime',
  showModelLabel: true,
  showUsageStats: true,
}

function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && (ACCENT_COLORS as readonly string[]).includes(value)
}

/**
 * 将（可能为部分或带历史脏键的）偏好合并到完整偏好对象之上：
 * 仅采纳已知键，缺失/为 null 的回退默认值，从而丢弃旧版本遗留字段。
 */
export function mergePreferences(
  partial: Partial<UserPreferences> | null | undefined,
): UserPreferences {
  // 旧版本只有单一 sendOnEnter：迁移为桌面端设置，缺失新键时兜底继承其布尔值，
  // 旧键不出现在返回对象里、下次落库即被自然清除。
  const legacy = partial as { sendOnEnter?: unknown } | null | undefined
  const legacySendOnEnterDesktop =
    typeof legacy?.sendOnEnter === 'boolean' ? legacy.sendOnEnter : undefined
  return {
    autoScrollOnOpen: partial?.autoScrollOnOpen ?? DEFAULT_PREFERENCES.autoScrollOnOpen,
    showScrollToBottom: partial?.showScrollToBottom ?? DEFAULT_PREFERENCES.showScrollToBottom,
    showTimelineNav: partial?.showTimelineNav ?? DEFAULT_PREFERENCES.showTimelineNav,
    showNewChatGradientGlow:
      partial?.showNewChatGradientGlow ?? DEFAULT_PREFERENCES.showNewChatGradientGlow,
    sendOnEnterDesktop:
      partial?.sendOnEnterDesktop ??
      legacySendOnEnterDesktop ??
      DEFAULT_PREFERENCES.sendOnEnterDesktop,
    sendOnEnterMobile: partial?.sendOnEnterMobile ?? DEFAULT_PREFERENCES.sendOnEnterMobile,
    defaultExpandReasoning:
      partial?.defaultExpandReasoning ?? DEFAULT_PREFERENCES.defaultExpandReasoning,
    accentColor: isAccentColor(partial?.accentColor)
      ? partial.accentColor
      : DEFAULT_PREFERENCES.accentColor,
    messageFontSize: partial?.messageFontSize ?? DEFAULT_PREFERENCES.messageFontSize,
    showMessageTime: partial?.showMessageTime ?? DEFAULT_PREFERENCES.showMessageTime,
    messageTimeFormat: partial?.messageTimeFormat ?? DEFAULT_PREFERENCES.messageTimeFormat,
    showModelLabel: partial?.showModelLabel ?? DEFAULT_PREFERENCES.showModelLabel,
    showUsageStats: partial?.showUsageStats ?? DEFAULT_PREFERENCES.showUsageStats,
  }
}
