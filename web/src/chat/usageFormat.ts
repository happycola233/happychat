import type { MessageCostDisplayDTO } from '@shared/types/api'

function trim1(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '')
}

// 通用时长格式放在 lib 中；保留此导出，避免聊天组件的领域格式入口分裂。
export { formatDuration } from '../lib/format'

/** 紧凑显示 token 数：3100→"3.1K"、16→"16"、1_200_000→"1.2M"。 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k >= 100 ? Math.round(k) : trim1(k)}K`
  }
  const m = n / 1_000_000
  return `${m >= 100 ? Math.round(m) : trim1(m)}M`
}

/** 生成速度 tok/s = 输出 token / 生成秒数；数据不足时返回 null。 */
export function computeTps(outputTokens: number, durationMs: number | null): number | null {
  if (!durationMs || durationMs <= 0 || outputTokens <= 0) return null
  return outputTokens / (durationMs / 1000)
}

export function formatTps(tps: number): string {
  return tps >= 100 ? String(Math.round(tps)) : trim1(tps)
}

/** 美元成本：保留小额请求所需精度，非零但低于一百万分之一美元时使用下限文案。 */
export function formatCostUsd(costUsd: number | null | undefined): string | null {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd <= 0) return null
  if (costUsd < 0.000001) return '<$0.000001'
  return `$${costUsd.toLocaleString('en-US', {
    minimumFractionDigits: costUsd >= 0.01 ? 2 : 0,
    maximumFractionDigits: costUsd >= 0.01 ? 4 : 6,
    useGrouping: false,
  })}`
}

/** 人民币成本沿用美元的小额精度策略，避免低成本请求被四舍五入成 0。 */
function formatCostCny(costCny: number): string {
  if (costCny < 0.000001) return '<¥0.000001'
  return `¥${costCny.toLocaleString('zh-CN', {
    minimumFractionDigits: costCny >= 0.01 ? 2 : 0,
    maximumFractionDigits: costCny >= 0.01 ? 4 : 6,
    useGrouping: false,
  })}`
}

export interface FormattedMessageCost {
  value: string
  title: string
}

/**
 * 聊天消息成本展示：原始数据始终是 USD；仅在拿到有效实时汇率时换算为 CNY。
 * CNY 悬停说明保留原始 USD 与换算汇率，上游不可用时明确回退为 USD。
 */
export function formatMessageCost(
  costUsd: number | null | undefined,
  display?: MessageCostDisplayDTO,
): FormattedMessageCost | null {
  const originalUsd = formatCostUsd(costUsd)
  if (!originalUsd || typeof costUsd !== 'number') return null
  if (display?.currency !== 'CNY') {
    return { value: originalUsd, title: '本次预估成本（USD）' }
  }

  const rate = display.usdToCnyRate
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return {
      value: originalUsd,
      title: `人民币实时汇率暂不可用，显示原始成本：${originalUsd} USD`,
    }
  }

  const formattedRate = rate.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
    useGrouping: false,
  })
  return {
    value: formatCostCny(costUsd * rate),
    title: `本次预估成本（CNY）；原始成本：${originalUsd} USD；汇率：1 USD ≈ ${formattedRate} CNY`,
  }
}

/** 消息时间显示：'time'=HH:mm；'datetime'=YYYY/MM/DD HH:mm（均 24 小时制）。 */
export function formatMessageTime(ts: number, format: 'time' | 'datetime' = 'time'): string {
  const d = new Date(ts)
  if (format === 'datetime') {
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
