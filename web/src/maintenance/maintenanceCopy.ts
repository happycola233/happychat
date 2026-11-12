import type { MaintenanceLanguage, MaintenanceNotice } from '@shared/schemas/maintenance'

export type MaintenanceCopyLanguage = Exclude<MaintenanceLanguage, 'both'>

interface MaintenanceCopy {
  /** 写入 lang 属性：影响断行、字体回退与读屏发音。 */
  locale: string
  documentTitle: string
  title: string
  body: string
  expectedEnd: (time: string) => string
  thanks: string
  signIn: string
  switchAccount: string
  timeFormat: Intl.DateTimeFormatOptions
}

export const MAINTENANCE_COPY: Record<MaintenanceCopyLanguage, MaintenanceCopy> = {
  zh: {
    locale: 'zh-CN',
    documentTitle: '维护中',
    title: '我们很快回来',
    body: 'HappyChat 正在维护，暂时无法使用。你的聊天记录都完好保存着，维护结束后，这个页面会自动恢复。',
    expectedEnd: (time) => `预计 ${time} 恢复。`,
    thanks: '感谢你的耐心等待。',
    signIn: '管理员登录',
    switchAccount: '切换账号',
    timeFormat: {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
  },
  en: {
    locale: 'en',
    documentTitle: 'Under maintenance',
    title: 'We’ll be back soon',
    body: 'HappyChat is down for maintenance and can’t be used for the moment. Your conversations are safe, and this page will come back on its own as soon as we’re done.',
    expectedEnd: (time) => `We expect to be back by ${time}.`,
    thanks: 'Thank you for your patience.',
    signIn: 'Admin sign in',
    switchAccount: 'Switch account',
    timeFormat: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  },
}

/** 维护页要展示的语言，按出现顺序排列。 */
export function maintenanceLanguages(language: MaintenanceLanguage): MaintenanceCopyLanguage[] {
  return language === 'both' ? ['zh', 'en'] : [language]
}

export function maintenanceNote(
  notice: MaintenanceNotice,
  language: MaintenanceCopyLanguage,
): string | null {
  return language === 'zh' ? notice.noteZh : notice.noteEn
}

/** 预计恢复时间按访客所在时区显示；已经过去的时间不再展示。 */
export function formatExpectedEnd(
  expectedEndAt: number | null,
  language: MaintenanceCopyLanguage,
  now: number,
): string | null {
  if (expectedEndAt === null || expectedEndAt <= now) return null
  const copy = MAINTENANCE_COPY[language]
  const time = new Intl.DateTimeFormat(copy.locale, copy.timeFormat).format(expectedEndAt)
  return copy.expectedEnd(time)
}
