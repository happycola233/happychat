import { describe, expect, it } from 'vitest'
import type { UsageHeatmapCellDTO } from '@shared/types/api'
import { buildHeatmapGrid } from './heatmapGrid'

/** 生成从 start 起 count 天的连续序列；requests 由回调决定。 */
function series(start: string, count: number, requests: (index: number) => number): UsageHeatmapCellDTO[] {
  const [year, month, day] = start.split('-').map(Number)
  const base = Date.UTC(year!, month! - 1, day!)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(base + index * 86_400_000).toISOString().slice(0, 10)
    const value = requests(index)
    return { date, requests: value, totalTokens: value * 100, costUsd: value * 0.5 }
  })
}

describe('buildHeatmapGrid', () => {
  it('按周分列，行＝星期，首列前补空保持行对齐', () => {
    // 2026-03-04 是周三
    const grid = buildHeatmapGrid(series('2026-03-04', 9, () => 1))
    expect(grid.weekdayLabels[0]).toBe('周一')
    // 周一起始：周三落在第 3 行（索引 2），前两行补 null
    expect(grid.weeks[0]?.slice(0, 2)).toEqual([null, null])
    expect(grid.weeks[0]?.[2]?.date).toBe('2026-03-04')
    expect(grid.weeks[0]?.[6]?.date).toBe('2026-03-08')
    expect(grid.weeks[1]?.[0]?.date).toBe('2026-03-09')
    // 最后一列尾部补空
    expect(grid.weeks[1]?.[4]).toBeNull()
    expect(grid.weeks).toHaveLength(2)
  })

  it('支持周日起始（行标签与行索引同步旋转）', () => {
    const grid = buildHeatmapGrid(series('2026-03-04', 9, () => 1), { weekStart: 'sun' })
    expect(grid.weekdayLabels[0]).toBe('周日')
    expect(grid.weeks[0]?.[3]?.date).toBe('2026-03-04') // 周三在索引 3
    expect(grid.weeks[1]?.[0]?.date).toBe('2026-03-08') // 周日另起一列
  })

  it('分级按非零值分位数，极端值不会把其余天压成同一档', () => {
    const grid = buildHeatmapGrid(
      series('2026-03-02', 8, (index) => (index === 7 ? 500 : index + 1)),
    )
    const days = grid.weeks.flat().filter((day) => day !== null)
    const levels = days.map((day) => day.level)
    expect(new Set(levels).size).toBeGreaterThan(2)
    expect(levels[levels.length - 1]).toBe(4)
    expect(grid.max).toBe(500)
  })

  it('零活动的天是 0 级，全空数据不产生分级', () => {
    const grid = buildHeatmapGrid(series('2026-03-02', 7, () => 0))
    expect(grid.weeks.flat().every((day) => day?.level === 0)).toBe(true)
    expect(grid.activeDays).toBe(0)
    expect(grid.total).toBe(0)
  })

  it('切换口径改变 value 与总量，但不改变网格结构', () => {
    const cells = series('2026-03-02', 7, () => 2)
    const requests = buildHeatmapGrid(cells, { metric: 'requests' })
    const tokens = buildHeatmapGrid(cells, { metric: 'tokens' })
    const cost = buildHeatmapGrid(cells, { metric: 'cost' })
    expect(requests.total).toBe(14)
    expect(tokens.total).toBe(1400)
    expect(cost.total).toBeCloseTo(7)
    expect(tokens.weeks).toHaveLength(requests.weeks.length)
    // 原始三项在每格都保留，供 tooltip 同时展示
    const day = requests.weeks.flat().find((item) => item !== null)!
    expect(day.requests).toBe(2)
    expect(day.totalTokens).toBe(200)
    expect(day.costUsd).toBeCloseTo(1)
  })

  it('月份刻度稀疏放置，相邻过近的标签会被跳过', () => {
    const grid = buildHeatmapGrid(series('2026-01-01', 120, () => 1))
    expect(grid.monthLabels.length).toBeGreaterThanOrEqual(3)
    for (let index = 1; index < grid.monthLabels.length; index++) {
      expect(grid.monthLabels[index]!.weekIndex - grid.monthLabels[index - 1]!.weekIndex).toBeGreaterThanOrEqual(3)
    }
    expect(grid.monthLabels[0]?.label).toMatch(/月$/)
  })

  it('空数据安全返回空网格', () => {
    const grid = buildHeatmapGrid([])
    expect(grid.weeks).toEqual([])
    expect(grid.monthLabels).toEqual([])
    expect(grid.max).toBe(0)
  })
})
