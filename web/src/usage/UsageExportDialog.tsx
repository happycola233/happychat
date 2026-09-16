import { useState } from 'react'
import { Download } from 'lucide-react'
import type { UsageStatsDTO } from '@shared/types/api'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { downloadUsageCsv, type UsageExportKind } from './usageExport'

export function UsageExportDialog({
  stats,
  timeZone,
  dateRange,
  onClose,
}: {
  stats: UsageStatsDTO
  timeZone?: string
  dateRange: string
  onClose: () => void
}) {
  const [kind, setKind] = useState<UsageExportKind>('trend')
  const choices: { value: UsageExportKind; label: string; hint: string; count: number }[] = [
    {
      value: 'trend',
      label: '用量趋势',
      hint: '按时段汇总请求、Token 与预估花费',
      count: stats.trend.length,
    },
    {
      value: 'models',
      label: '模型用量',
      hint: '全部模型的用量与平均花费',
      count: stats.byModel.length,
    },
    {
      value: 'activity',
      label: '每日活动 · 近一年',
      hint: '全年每日用量，包含无活动的日期',
      count: stats.heatmap.length,
    },
  ]
  return (
    <Modal
      open
      onClose={onClose}
      title="导出用量"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              downloadUsageCsv(stats, kind, timeZone)
              onClose()
            }}
            disabled={choices.find((choice) => choice.value === kind)!.count === 0}
          >
            <Download className="h-4 w-4" />
            下载 CSV
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
          选择要导出的数据
        </legend>
        {choices.map((choice) => (
          <label
            key={choice.value}
            className="flex cursor-pointer items-center gap-3 rounded-lg bg-neutral-50 px-4 py-3 has-checked:bg-sky-50 dark:bg-neutral-800/50 dark:has-checked:bg-sky-500/10"
          >
            <input
              type="radio"
              name="usage-export"
              value={choice.value}
              checked={kind === choice.value}
              onChange={() => setKind(choice.value)}
              className="h-4 w-4 shrink-0 accent-sky-600"
            />
            <span className="min-w-0 flex-1">
              <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                {choice.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                {choice.hint}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              {choice.count} 行
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mt-4 text-xs leading-6 text-neutral-500 dark:text-neutral-400">
        {kind === 'activity'
          ? stats.heatmap[0]!.date + ' – ' + stats.heatmap.at(-1)!.date
          : dateRange}
        <br />
        CSV 保留完整数值，可用 Excel 或其他表格软件打开。
      </p>
    </Modal>
  )
}
