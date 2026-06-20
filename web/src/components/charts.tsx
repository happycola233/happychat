import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useIsDark } from '../lib/useIsDark'
import { formatBucketTick, formatCompact, formatDateTime } from '../lib/format'

export interface SeriesDef {
  key: string
  name: string
  color: string
}

type Bucket = 'hour' | 'day'
type ValueFormat = (n: number) => string

interface TooltipDatum {
  dataKey?: string | number
  name?: string
  value?: number | string
  color?: string
}

/** 自定义 tooltip：作为 ReactElement 传给 recharts，由其克隆并注入 active/payload/label。 */
function ChartTooltip({
  active,
  payload,
  label,
  valueFormat,
}: {
  active?: boolean
  payload?: TooltipDatum[]
  label?: number | string
  valueFormat: ValueFormat
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-200">
        {typeof label === 'number' ? formatDateTime(label) : ''}
      </div>
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="text-neutral-500 dark:text-neutral-400">{p.name}</span>
          <span className="ml-auto tabular-nums text-neutral-800 dark:text-neutral-100">
            {valueFormat(Number(p.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  )
}

interface TrendChartProps {
  data: Record<string, number>[]
  series: SeriesDef[]
  bucket: Bucket
  height?: number
  valueFormat?: ValueFormat
}

/** 多序列折线趋势图（token 趋势、成本趋势等）。 */
export function TrendChart({
  data,
  series,
  bucket,
  height = 260,
  valueFormat = formatCompact,
}: TrendChartProps) {
  const dark = useIsDark()
  const grid = dark ? '#262626' : '#e5e7eb'
  const axis = dark ? '#9ca3af' : '#6b7280'
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={(v: number) => formatBucketTick(v, bucket)}
          stroke={axis}
          fontSize={11}
          tickLine={false}
          axisLine={{ stroke: grid }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={valueFormat}
          stroke={axis}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip content={<ChartTooltip valueFormat={valueFormat} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

interface HealthPoint {
  ts: number
  requests: number
  errors: number
}

/** 请求健康时间线：堆叠柱（成功绿 + 错误红）。 */
export function HealthTimeline({
  data,
  bucket,
  height = 220,
}: {
  data: HealthPoint[]
  bucket: Bucket
  height?: number
}) {
  const dark = useIsDark()
  const grid = dark ? '#262626' : '#e5e7eb'
  const axis = dark ? '#9ca3af' : '#6b7280'
  const rows = data.map((d) => ({
    ts: d.ts,
    success: Math.max(0, d.requests - d.errors),
    errors: d.errors,
  }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={(v: number) => formatBucketTick(v, bucket)}
          stroke={axis}
          fontSize={11}
          tickLine={false}
          axisLine={{ stroke: grid }}
          minTickGap={28}
        />
        <YAxis
          allowDecimals={false}
          stroke={axis}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip content={<ChartTooltip valueFormat={(n) => String(n)} />} />
        <Bar dataKey="success" name="成功" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
        <Bar dataKey="errors" name="失败" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
