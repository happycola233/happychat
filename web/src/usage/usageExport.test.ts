import { describe, expect, it } from 'vitest'
import { buildUsageCsv } from './usageExport'

const stats = {
  windowStart: Date.parse('2026-11-01T04:00:00Z'),
  windowEnd: Date.parse('2026-11-02T05:00:00Z'),
  trend: [
    {
      ts: Date.parse('2026-11-01T05:00:00Z'),
      requests: 2,
      totalTokens: 1234567,
      costUsd: 0.000001234567,
    },
    { ts: Date.parse('2026-11-01T06:00:00Z'), requests: 3, totalTokens: 543, costUsd: 0.23 },
  ],
  byModel: [
    {
      modelId: null,
      modelLabel: '示例, "模型"\n历史版本',
      requests: 2,
      totalTokens: 1234567,
      costUsd: 0.000001234567,
    },
  ],
  heatmap: [
    { date: '2026-10-31', requests: 0, totalTokens: 0, costUsd: 0 },
    { date: '2026-11-01', requests: 5, totalTokens: 1235110, costUsd: 0.230001234567 },
  ],
}

describe('个人用量 CSV', () => {
  it('UTF-8 BOM 与完整数值可直接用于电子表格', () => {
    const csv = buildUsageCsv(stats, 'trend', 'America/New_York')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain(',2,1234567,0.000001234567')
    expect(csv).not.toContain('1.2M')
  })
  it('夏令时回拨的两个同名本地小时保留独立 UTC 时间', () => {
    const csv = buildUsageCsv(stats, 'trend', 'America/New_York')
    expect(csv).toContain('"2026-11-01T05:00:00.000Z","2026-11-01 01:00:00"')
    expect(csv).toContain('"2026-11-01T06:00:00.000Z","2026-11-01 01:00:00"')
  })
  it('模型名称中的逗号、引号与换行保持为单个 CSV 字段', () => {
    const csv = buildUsageCsv(stats, 'models', 'Asia/Shanghai')
    expect(csv).toContain('"示例, ""模型""\n历史版本",2,1234567,0.000001234567,6.172835e-7')
    expect(csv).toContain('"2026-11-02T05:00:00.000Z"')
  })
  it('外部模型名称不会被 Excel 解释为公式', () => {
    for (const name of ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', ' \t=1+1']) {
      const csv = buildUsageCsv(
        { ...stats, byModel: [{ ...stats.byModel[0]!, modelLabel: name }] },
        'models',
        'UTC',
      )
      expect(csv).toContain('"\'' + name + '",2,')
    }
  })
  it('每日活动保留所选窗口之外的全年日期及零用量', () => {
    const csv = buildUsageCsv(stats, 'activity', 'America/New_York')
    expect(csv.split('\r\n')).toHaveLength(3)
    expect(csv).toContain('"2026-10-31","America/New_York",0,0,0')
  })
  it('空模型用量只导出表头，不制造数据行', () => {
    expect(buildUsageCsv({ ...stats, byModel: [] }, 'models', 'UTC').split('\r\n')).toHaveLength(1)
  })
})
