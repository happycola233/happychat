import { AlertTriangle, Info, ShieldAlert, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  AnnouncementChannel,
  AnnouncementLevel,
  AnnouncementPhase,
} from '@shared/types/domain'
import type { BadgeTone } from '../components/ui/Badge'

/** 级别 → 展示元信息（图标 / 徽章色 / 横幅配色 / 图标色），深浅色成对。 */
export interface LevelMeta {
  label: string
  tone: BadgeTone
  icon: LucideIcon
  /** 横幅整体配色：边框 + 背景 + 文字（含 dark:）。 */
  bannerClass: string
  /** 图标与强调色（含 dark:）。 */
  accentClass: string
}

export const LEVEL_META: Record<AnnouncementLevel, LevelMeta> = {
  info: {
    label: '通知',
    tone: 'info',
    icon: Info,
    bannerClass:
      'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100',
    accentClass: 'text-sky-600 dark:text-sky-400',
  },
  success: {
    label: '更新',
    tone: 'success',
    icon: Sparkles,
    bannerClass:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100',
    accentClass: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    label: '提醒',
    tone: 'warning',
    icon: AlertTriangle,
    bannerClass:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100',
    accentClass: 'text-amber-600 dark:text-amber-400',
  },
  critical: {
    label: '重要',
    tone: 'danger',
    icon: ShieldAlert,
    bannerClass:
      'border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100',
    accentClass: 'text-red-600 dark:text-red-400',
  },
}

/** 触达渠道 → 中文说明（管理端选择与列表展示用）。 */
export const CHANNEL_LABEL: Record<AnnouncementChannel, string> = {
  silent: '仅通知中心',
  banner: '顶部横幅',
  modal: '强提示弹窗',
}

/** 派生运行态 → 徽章文案与色（管理端列表用）。 */
export const PHASE_META: Record<AnnouncementPhase, { label: string; tone: BadgeTone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  scheduled: { label: '待发布', tone: 'info' },
  active: { label: '生效中', tone: 'success' },
  expired: { label: '已结束', tone: 'neutral' },
}

/** 受众 → 中文（用于管理端展示）。 */
export const AUDIENCE_LABEL = {
  all: '全体用户',
  admins: '仅管理员',
} as const

/**
 * 公告时间的友好展示：一周内相对时间，更久给出日期。
 * 传入 epoch ms。
 */
export function formatAnnouncementTime(ms: number): string {
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day} 天前`
  const d = new Date(ms)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return sameYear ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`
}
