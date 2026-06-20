export const RANGE_PRESETS = [
  { key: '24h', label: '24小时', hours: 24 },
  { key: '7d', label: '7天', hours: 168 },
  { key: '30d', label: '30天', hours: 720 },
  { key: 'all', label: '全部', hours: 0 },
] as const

export type RangeKey = (typeof RANGE_PRESETS)[number]['key']

/** 把预设区间转成查询用的 { from? }（'all' 无下界）。 */
export function rangeToFilter(key: RangeKey, now = Date.now()): { from?: number } {
  const preset = RANGE_PRESETS.find((r) => r.key === key)
  return preset && preset.hours ? { from: now - preset.hours * 3_600_000 } : {}
}
