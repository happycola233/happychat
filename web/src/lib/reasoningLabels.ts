import type { ReasoningEffort } from '@shared/types/domain'

export const REASONING_EFFORT_SHORT_LABELS: Record<ReasoningEffort, string> = {
  none: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

// 菜单和后台配置里展示上游实际值，避免“极高”对应哪个 effort 不够明确。
export const REASONING_EFFORT_OPTION_LABELS: Record<ReasoningEffort, string> = {
  none: '关闭（none）',
  low: '低（low）',
  medium: '中（medium）',
  high: '高（high）',
  xhigh: '极高（xhigh）',
}
