import type { UsageStatsDTO } from '@shared/types/api'

export type UsageExportKind = 'trend' | 'models' | 'activity'

/** 模型名称来自用户可配置内容：正确转义 CSV，并避免电子表格把名称当公式执行。 */
function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value)
  const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}

export function buildUsageCsv(
  stats: Pick<UsageStatsDTO, 'trend' | 'byModel' | 'heatmap' | 'windowStart' | 'windowEnd'>,
  kind: UsageExportKind,
  timeZone?: string,
): string {
  const table: (string | number)[][] =
    kind === 'trend'
      ? [
          ['时间（UTC）', '本地时间', '时区', '请求数', 'Token', '预估花费（USD）'],
          ...stats.trend.map((point) => [
            new Date(point.ts).toISOString(),
            new Date(point.ts).toLocaleString('sv-SE', { timeZone, hour12: false }),
            timeZone ?? '浏览器本地时区',
            point.requests,
            point.totalTokens,
            point.costUsd,
          ]),
        ]
      : kind === 'models'
        ? [
            [
              '模型',
              '请求数',
              'Token',
              '预估花费（USD）',
              '每次平均花费（USD）',
              '周期开始（UTC）',
              '周期结束（UTC，不含）',
            ],
            ...stats.byModel.map((row) => [
              row.modelLabel,
              row.requests,
              row.totalTokens,
              row.costUsd,
              row.requests ? row.costUsd / row.requests : 0,
              new Date(stats.windowStart).toISOString(),
              new Date(stats.windowEnd).toISOString(),
            ]),
          ]
        : [
            ['日期', '时区', '请求数', 'Token', '预估花费（USD）'],
            ...stats.heatmap.map((day) => [
              day.date,
              timeZone ?? '浏览器本地时区',
              day.requests,
              day.totalTokens,
              day.costUsd,
            ]),
          ]
  return '\uFEFF' + table.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function downloadUsageCsv(stats: UsageStatsDTO, kind: UsageExportKind, timeZone?: string) {
  const content = buildUsageCsv(stats, kind, timeZone)
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download =
    'happychat-' +
    kind +
    '-' +
    (kind === 'activity' ? 'year' : stats.view) +
    '-' +
    stats.heatmap.at(-1)!.date +
    '.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
