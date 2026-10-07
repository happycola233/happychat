import type { MessageCostDisplayDTO } from '@shared/types/api'

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
  if (costCny === 0) return '¥0'
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

export function costDisplayCurrency(display?: MessageCostDisplayDTO): 'USD' | 'CNY' {
  const rate = display?.usdToCnyRate
  return display?.currency === 'CNY' &&
    typeof rate === 'number' &&
    Number.isFinite(rate) &&
    rate > 0
    ? 'CNY'
    : 'USD'
}

/** 明细与总额共用币种和精度；明细中的零费用仍需明确展示。 */
export function formatCostAmount(costUsd: number, display?: MessageCostDisplayDTO): string {
  return costDisplayCurrency(display) === 'CNY'
    ? formatCostCny(costUsd * display!.usdToCnyRate!)
    : (formatCostUsd(costUsd) ?? '$0')
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
  if (costDisplayCurrency(display) !== 'CNY') {
    return {
      value: originalUsd,
      title: `人民币实时汇率暂不可用，显示原始成本：${originalUsd} USD`,
    }
  }

  const formattedRate = rate!.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
    useGrouping: false,
  })
  return {
    value: formatCostAmount(costUsd, display),
    title: `本次预估成本（CNY）；原始成本：${originalUsd} USD；汇率：1 USD ≈ ${formattedRate} CNY`,
  }
}
