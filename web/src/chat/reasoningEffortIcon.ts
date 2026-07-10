import type { ReasoningEffort } from '@shared/types/domain'

export type ReasoningEffortIconKey = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * 自定义上游值没有专属图形：max 复用原 xhigh 图标，其余未知值统一回退到 high。
 * 显式 switch 也避免 __proto__/constructor 等字符串落入对象原型属性。
 */
export function resolveReasoningEffortIconKey(
  effort: ReasoningEffort | null | undefined,
): ReasoningEffortIconKey {
  switch (effort) {
    case 'none':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return effort
    case 'max':
      return 'xhigh'
    default:
      return 'high'
  }
}
