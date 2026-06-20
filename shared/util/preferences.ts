import type { UserPreferences } from '../types/domain'

/** 账户级偏好的默认值，前后端共用以保证一致。 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  autoScrollOnOpen: true,
  showScrollToBottom: true,
  sendOnEnter: true,
  defaultExpandReasoning: true,
  messageFontSize: 'medium',
  showMessageTime: true,
  messageTimeFormat: 'datetime',
  showModelLabel: true,
  showUsageStats: true,
}

/**
 * 将（可能为部分或带历史脏键的）偏好合并到完整偏好对象之上：
 * 仅采纳已知键，缺失/为 null 的回退默认值，从而丢弃旧版本遗留字段。
 */
export function mergePreferences(
  partial: Partial<UserPreferences> | null | undefined,
): UserPreferences {
  return {
    autoScrollOnOpen: partial?.autoScrollOnOpen ?? DEFAULT_PREFERENCES.autoScrollOnOpen,
    showScrollToBottom: partial?.showScrollToBottom ?? DEFAULT_PREFERENCES.showScrollToBottom,
    sendOnEnter: partial?.sendOnEnter ?? DEFAULT_PREFERENCES.sendOnEnter,
    defaultExpandReasoning:
      partial?.defaultExpandReasoning ?? DEFAULT_PREFERENCES.defaultExpandReasoning,
    messageFontSize: partial?.messageFontSize ?? DEFAULT_PREFERENCES.messageFontSize,
    showMessageTime: partial?.showMessageTime ?? DEFAULT_PREFERENCES.showMessageTime,
    messageTimeFormat: partial?.messageTimeFormat ?? DEFAULT_PREFERENCES.messageTimeFormat,
    showModelLabel: partial?.showModelLabel ?? DEFAULT_PREFERENCES.showModelLabel,
    showUsageStats: partial?.showUsageStats ?? DEFAULT_PREFERENCES.showUsageStats,
  }
}
