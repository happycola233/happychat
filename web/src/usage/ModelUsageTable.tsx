import { useState } from 'react'
import { ChevronDown, ChevronUp, SearchX } from 'lucide-react'
import type { UsageModelStatDTO } from '@shared/types/api'
import { ModelIconMark } from '../components/ModelIcon'
import { Button } from '../components/ui/Button'
import { SearchField } from '../components/ui/SearchField'
import { Select } from '../components/ui/Select'
import { useModels } from '../hooks/useModels'
import { formatInt, formatPercent } from '../lib/format'
import { UsageSection, UsageSectionFooter, UsageValue } from './UsagePrimitives'
import {
  filterAndSortModels,
  formatUsageMetric,
  usageModelKey,
  USAGE_METRICS,
  type UsageMetric,
} from './usagePresentation'

const VISIBLE_MODEL_COUNT = 6

/** 搜索只改变可见行，占比始终相对于整个统计窗口，避免筛选后误读。 */
export function ModelUsageTable({
  rows,
  viewLabel,
}: {
  rows: UsageModelStatDTO[]
  viewLabel?: string
}) {
  const { data: models = [] } = useModels()
  const [search, setSearch] = useState('')
  const [metric, setMetric] = useState<UsageMetric>('requests')
  const [expanded, setExpanded] = useState(false)
  const filtered = filterAndSortModels(rows, search, metric)
  const visible = expanded || search.trim() ? filtered : filtered.slice(0, VISIBLE_MODEL_COUNT)
  const total = rows.reduce((sum, row) => sum + row[metric], 0)
  const metricLabel = USAGE_METRICS.find((item) => item.value === metric)!.label
  const modelIdentity = (row: UsageModelStatDTO) => {
    const model = models.find((item) => item.id === row.modelId)
    return (
      <div className="flex min-w-0 items-center gap-3">
        <ModelIconMark
          icon={model?.icon ?? null}
          modelId={model?.modelId ?? row.modelLabel}
          displayName={row.modelLabel}
          size="md"
        />
        <div className="min-w-0">
          <div className="break-words text-sm font-medium text-neutral-800 dark:text-neutral-100">
            {row.modelLabel}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="h-1 w-12 overflow-hidden rounded-full bg-neutral-200/70 dark:bg-neutral-700">
              <span
                className="block h-full rounded-full bg-sky-500/80"
                style={{ width: (total ? (row[metric] / total) * 100 : 0) + '%' }}
              />
            </span>
            <span>
              {metricLabel}占比 {formatPercent(total ? row[metric] / total : 0)}
            </span>
          </div>
        </div>
      </div>
    )
  }
  const number = (row: UsageModelStatDTO, key: UsageMetric) => (
    <UsageValue exact={formatUsageMetric(row[key], key, true)}>
      {formatUsageMetric(row[key], key)}
    </UsageValue>
  )

  return (
    <UsageSection
      id="usage-models"
      title="模型用量"
      description={(viewLabel ? viewLabel + ' · ' : '') + rows.length + ' 个模型'}
      actions={
        <div className="flex w-full min-w-0 gap-2 sm:w-auto">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="搜索模型"
            className="flex-1 sm:w-48"
          />
          <Select
            aria-label="模型排序"
            value={metric}
            className="w-32 shrink-0"
            options={USAGE_METRICS.map((item) => ({
              value: item.value,
              label: '按' + item.label + '排序',
            }))}
            onChange={(event) => setMetric(event.target.value as UsageMetric)}
          />
        </div>
      }
    >
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-9 text-sm text-neutral-500 dark:text-neutral-400">
          <SearchX aria-hidden className="h-6 w-6 text-neutral-400" />
          <p>{search ? '没有找到匹配的模型' : '这段时间还没有模型用量'}</p>
          {search && (
            <Button variant="ghost" onClick={() => setSearch('')}>
              清除搜索
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="hidden sm:block">
            <table className="w-full table-fixed text-right text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
              <caption className="sr-only">
                {viewLabel}模型用量，按{metricLabel}从高到低排序
              </caption>
              <thead className="bg-neutral-100/80 text-xs text-neutral-500 dark:bg-neutral-800/70 dark:text-neutral-400">
                <tr>
                  <th
                    scope="col"
                    className="w-[42%] rounded-l-lg px-3 py-2.5 text-left font-medium"
                  >
                    模型 / 占比
                  </th>
                  <th
                    scope="col"
                    aria-sort={metric === 'requests' ? 'descending' : 'none'}
                    className="px-3 py-2.5 font-medium"
                  >
                    请求
                  </th>
                  <th
                    scope="col"
                    aria-sort={metric === 'totalTokens' ? 'descending' : 'none'}
                    className="px-3 py-2.5 font-medium"
                  >
                    Token
                  </th>
                  <th
                    scope="col"
                    aria-sort={metric === 'costUsd' ? 'descending' : 'none'}
                    className="rounded-r-lg px-3 py-2.5 font-medium"
                  >
                    花费 · USD
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200/50 dark:divide-neutral-800">
                {visible.map((row) => (
                  <tr
                    key={usageModelKey(row)}
                    className="hover:bg-neutral-100/50 dark:hover:bg-neutral-800/30"
                  >
                    <th scope="row" className="px-3 py-3.5 text-left font-normal">
                      {modelIdentity(row)}
                    </th>
                    <td className="px-3 py-3.5">{number(row, 'requests')}</td>
                    <td className="px-3 py-3.5">{number(row, 'totalTokens')}</td>
                    <td className="px-3 py-3.5">
                      {number(row, 'costUsd')}
                      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        {row.requests
                          ? formatUsageMetric(row.costUsd / row.requests, 'costUsd')
                          : '$0'}{' '}
                        / 次
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-neutral-200/60 sm:hidden dark:divide-neutral-800">
            {visible.map((row) => (
              <li key={usageModelKey(row)} className="py-4 first:pt-0 last:pb-0">
                {modelIdentity(row)}
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-neutral-700 dark:text-neutral-200">
                  {USAGE_METRICS.map((item) => (
                    <div key={item.value}>
                      <dt className="mb-1.5 text-neutral-500 dark:text-neutral-400">
                        {item.label}
                        {item.value === 'costUsd' ? ' · USD' : ''}
                      </dt>
                      <dd className="font-medium">{number(row, item.value)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      <UsageSectionFooter
        note={
          <>
            {search ? '找到 ' + formatInt(filtered.length) + ' 个模型 · ' : ''}占比按
            {viewLabel ?? '当前时段'}全部模型的{metricLabel}计算
          </>
        }
        actions={
          !search.trim() &&
          rows.length > VISIBLE_MODEL_COUNT && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {expanded ? '收起列表' : '查看全部 ' + rows.length + ' 个模型'}
            </Button>
          )
        }
      />
    </UsageSection>
  )
}
