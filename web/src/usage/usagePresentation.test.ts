import { describe, expect, it } from 'vitest'
import type { UsageModelStatDTO } from '@shared/types/api'
import {
  filterAndSortModels,
  formatUsageMetric,
  readUsageView,
  usageDateRange,
  usageModelKey,
} from './usagePresentation'

const rows: UsageModelStatDTO[] = [
  { modelId: 'a', modelLabel: 'GPT Alpha', requests: 12, totalTokens: 14000, costUsd: 0.03 },
  { modelId: 'b', modelLabel: 'Claude Beta', requests: 7, totalTokens: 16000, costUsd: 0.3 },
  { modelId: null, modelLabel: 'GPT 历史模型', requests: 2, totalTokens: 500, costUsd: 0.04 },
]

describe('个人用量展示', () => {
  it('请求、Token、花费可分别排序，搜索忽略大小写与首尾空白', () => {
    expect(filterAndSortModels(rows, '', 'requests').map((row) => row.modelId)).toEqual([
      'a',
      'b',
      null,
    ])
    expect(filterAndSortModels(rows, '', 'totalTokens').map((row) => row.modelId)).toEqual([
      'b',
      'a',
      null,
    ])
    expect(filterAndSortModels(rows, '  gPt  ', 'costUsd').map((row) => row.modelId)).toEqual([
      null,
      'a',
    ])
    expect(rows.map((row) => row.modelId)).toEqual(['a', 'b', null])
  })
  it('同名模型与已删除模型的统计行仍有独立标识', () => {
    expect(usageModelKey(rows[0]!)).not.toBe(usageModelKey({ ...rows[0]!, modelId: null }))
  })
  it('无效 URL 窗口使用本月，合法窗口保持原值', () => {
    expect(readUsageView('week')).toBe('week')
    expect(readUsageView('last-year')).toBe('month')
    expect(readUsageView(null)).toBe('month')
  })
  it('缩写与完整数值分离，微小花费仍可查看精度', () => {
    expect(formatUsageMetric(1234567, 'totalTokens')).toBe('1.2M')
    expect(formatUsageMetric(1234567, 'totalTokens', true)).toBe('1,234,567')
    expect(formatUsageMetric(0.000125, 'costUsd', true)).toBe('$0.000125')
    expect(formatUsageMetric(0.000000125, 'costUsd', true)).toBe('$0.000000125')
  })
  it('日期范围按统计时区显示，单日不重复日期', () => {
    const at = Date.parse('2026-09-15T18:00:00Z')
    expect(usageDateRange(at, at + 1000, 'Asia/Shanghai')).toBe('2026/9/16')
    expect(usageDateRange(at, at + 86400000, 'America/New_York')).toBe('2026/9/15 – 2026/9/16')
  })
})
