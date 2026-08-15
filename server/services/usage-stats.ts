import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import type {
  UsageHeatmapCellDTO,
  UsageModelStatDTO,
  UsageStatsDTO,
  UsageTrendPointDTO,
} from '@shared/types/api'
import type {
  ModelPricing,
  QuotaWeekStart,
  UsageStatsView,
  UsageTrendGranularity,
} from '@shared/types/domain'
import { costUsd } from '@shared/util/cost'
import {
  canonicalizeIanaTimezone,
  zonedDateParts,
  zonedMidnightMs,
  zonedOffsetMinutes,
  type ZonedDateParts,
} from '@shared/util/timezone'
import { db } from '../db/client'
import { conversations, messages, usageLogs } from '../db/schema'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
/** 热力图默认覆盖一年（GitHub 贡献图同口径）。 */
export const USAGE_STATS_DEFAULT_DAYS = 371
export const USAGE_STATS_MAX_DAYS = 731
/** 分模型明细的默认窗口（管理端用户详情复用）。 */
export const USAGE_TREND_DAYS = 30

export interface UsageStatsOptions {
  /** 用户浏览器报告的 IANA 时区；历史分桶会使用每个时刻各自的 DST 偏移。 */
  timezone?: string
  /** 旧客户端兼容：未提供有效 IANA 时区时使用的固定 UTC 偏移（东为正）。 */
  tzOffsetMinutes?: number
  /** 热力图覆盖天数；与 `view` 无关，热力图恒为「近一年」视角。 */
  days?: number
  /** 窗口视图：今日 / 本周 / 本月 / 本年，默认本月。 */
  view?: UsageStatsView
  /** 「本周」的起始日，沿用站点限额配置，保证与额度周期同口径。 */
  weekStart?: QuotaWeekStart
}

/** 把偏移钳制在真实时区范围内，避免异常入参把日期推到很远的位置。 */
function normalizeOffsetMinutes(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-14 * 60, Math.min(14 * 60, Math.round(value!)))
}

interface UsageClock {
  /** 有值时按 IANA 历史规则换算；null 表示兼容旧客户端的固定偏移。 */
  timezone: string | null
  fixedOffsetMs: number
}

function resolveUsageClock(options: UsageStatsOptions): UsageClock {
  const timezone = canonicalizeIanaTimezone(options.timezone)
  return {
    timezone,
    fixedOffsetMs: timezone ? 0 : normalizeOffsetMinutes(options.tzOffsetMinutes) * MINUTE_MS,
  }
}

function fixedOffsetDateParts(timeMs: number, offsetMs: number): ZonedDateParts {
  const date = new Date(timeMs + offsetMs)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  }
}

function localDateParts(timeMs: number, clock: UsageClock): ZonedDateParts {
  return clock.timezone
    ? zonedDateParts(timeMs, clock.timezone)
    : fixedOffsetDateParts(timeMs, clock.fixedOffsetMs)
}

function localOffsetMs(timeMs: number, clock: UsageClock): number {
  return clock.timezone
    ? zonedOffsetMinutes(timeMs, clock.timezone) * MINUTE_MS
    : clock.fixedOffsetMs
}

function localMidnightMs(year: number, month: number, day: number, clock: UsageClock): number {
  return clock.timezone
    ? zonedMidnightMs(year, month, day, clock.timezone)
    : Date.UTC(year, month - 1, day) - clock.fixedOffsetMs
}

function wallDateKey(wallClockMs: number): string {
  return new Date(wallClockMs).toISOString().slice(0, 10)
}

function localDateKey(timeMs: number, clock: UsageClock): string {
  const parts = localDateParts(timeMs, clock)
  return wallDateKey(Date.UTC(parts.year, parts.month - 1, parts.day))
}

/** 按墙上日期回推 n 天（含今天），跨 DST 时不会用固定 24 小时推真实时刻。 */
function dateKeySeries(endMs: number, clock: UsageClock, days: number): string[] {
  const parts = localDateParts(endMs, clock)
  const endWallDate = Date.UTC(parts.year, parts.month - 1, parts.day)
  return Array.from({ length: days }, (_, index) =>
    wallDateKey(endWallDate - (days - index - 1) * DAY_MS),
  )
}

/** 窗口同时保留真实边界和墙上时间轴边界；后者用于与本地小时桶比较。 */
interface UsageWindow {
  startMs: number
  endMs: number
  wallStart: number
  wallEnd: number
  granularity: UsageTrendGranularity
}

/**
 * 解析窗口视图在此刻对应的自然周期。
 *
 * 边界按**用户浏览器本地时区**计算（与热力图逐字一致），而不是站点的 IANA 时区：
 * 个人面板的「今天」必须和用户手机上的今天一致。周起始沿用站点限额配置，
 * 这样「本周」与限额里的「每周」是同一个起点。
 */
function resolveUsageWindow(
  view: UsageStatsView,
  nowMs: number,
  clock: UsageClock,
  weekStart: QuotaWeekStart,
): UsageWindow {
  const parts = localDateParts(nowMs, clock)
  let wallStart = Date.UTC(parts.year, parts.month - 1, parts.day)
  let wallEnd: number
  let granularity: UsageTrendGranularity
  if (view === 'day') {
    wallEnd = wallStart + DAY_MS
    granularity = 'hour'
  } else if (view === 'week') {
    const weekday = new Date(wallStart).getUTCDay()
    const back = weekStart === 'sun' ? weekday : (weekday + 6) % 7
    wallStart -= back * DAY_MS
    wallEnd = wallStart + 7 * DAY_MS
    granularity = 'day'
  } else if (view === 'month') {
    wallStart = Date.UTC(parts.year, parts.month - 1, 1)
    wallEnd = Date.UTC(parts.year, parts.month, 1)
    granularity = 'day'
  } else {
    wallStart = Date.UTC(parts.year, 0, 1)
    wallEnd = Date.UTC(parts.year + 1, 0, 1)
    granularity = 'month'
  }
  const startDate = new Date(wallStart)
  const endDate = new Date(wallEnd)
  return {
    startMs: localMidnightMs(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + 1,
      startDate.getUTCDate(),
      clock,
    ),
    endMs: localMidnightMs(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth() + 1,
      endDate.getUTCDate(),
      clock,
    ),
    wallStart,
    wallEnd,
    granularity,
  }
}

/** 墙上时间轴里某时刻所属趋势桶的起点。 */
function trendWallBucketStart(wallMs: number, granularity: UsageTrendGranularity): number {
  if (granularity === 'hour') return Math.floor(wallMs / HOUR_MS) * HOUR_MS
  if (granularity === 'day') return Math.floor(wallMs / DAY_MS) * DAY_MS
  const date = new Date(wallMs)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

function nextTrendWallBucket(wallMs: number, granularity: UsageTrendGranularity): number {
  if (granularity === 'hour') return wallMs + HOUR_MS
  if (granularity === 'day') return wallMs + DAY_MS
  const date = new Date(wallMs)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

interface OffsetPeriod {
  startMs: number
  endMs: number
  offsetMs: number
}

/** 找到两个采样点之间 UTC 偏移首次变化的分钟边界。 */
function findOffsetTransition(
  clock: UsageClock,
  startMs: number,
  endMs: number,
  previousOffsetMs: number,
): number {
  let low = Math.floor(startMs / MINUTE_MS)
  let high = Math.ceil(endMs / MINUTE_MS)
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (localOffsetMs(middle * MINUTE_MS, clock) === previousOffsetMs) low = middle
    else high = middle
  }
  return high * MINUTE_MS
}

/**
 * 把查询范围切成 UTC 偏移稳定的少量区段。通常一年只有 2 次 DST 切换，随后 SQL
 * 可按每条日志发生时的区段平移本地小时，而不必把原始请求逐条读进内存。
 */
function resolveOffsetPeriods(clock: UsageClock, startMs: number, endMs: number): OffsetPeriod[] {
  if (!clock.timezone) {
    return [{ startMs, endMs, offsetMs: clock.fixedOffsetMs }]
  }
  const periods: OffsetPeriod[] = []
  let periodStart = startMs
  let cursor = startMs
  let offsetMs = localOffsetMs(cursor, clock)
  while (cursor < endMs) {
    const probe = Math.min(endMs, cursor + 6 * HOUR_MS)
    const probeOffset = localOffsetMs(probe, clock)
    if (probeOffset === offsetMs) {
      cursor = probe
      continue
    }
    const transition = findOffsetTransition(clock, cursor, probe, offsetMs)
    periods.push({ startMs: periodStart, endMs: transition, offsetMs })
    periodStart = transition
    cursor = transition
    offsetMs = localOffsetMs(transition, clock)
  }
  periods.push({ startMs: periodStart, endMs, offsetMs })
  return periods
}

/**
 * 墙上小时在各个偏移区段中的真实起点。用区间相交而不是只反解整点，因此既能
 * 保留秋季回拨的重复小时，也能覆盖 Lord Howe 一类半小时 DST 跳变后的半个小时桶。
 */
function realHourStarts(wallHour: number, periods: OffsetPeriod[]): number[] {
  const starts: number[] = []
  for (const period of periods) {
    const periodWallStart = period.startMs + period.offsetMs
    const periodWallEnd = period.endMs + period.offsetMs
    const intersectionStart = Math.max(wallHour, periodWallStart)
    if (intersectionStart < Math.min(wallHour + HOUR_MS, periodWallEnd)) {
      starts.push(intersectionStart - period.offsetMs)
    }
  }
  return starts
}

/** 枚举窗口内已经发生的趋势桶，补齐零值并正确保留 DST 回拨时的重复小时。 */
function trendBucketSeries(
  window: UsageWindow,
  nowMs: number,
  clock: UsageClock,
  periods: OffsetPeriod[],
): number[] {
  const nowParts = localDateParts(nowMs, clock)
  const nowWall = Date.UTC(
    nowParts.year,
    nowParts.month - 1,
    nowParts.day,
    nowParts.hour,
    nowParts.minute,
  )
  const lastWall = trendWallBucketStart(Math.min(nowWall, window.wallEnd - 1), window.granularity)
  const buckets: number[] = []
  let wallCursor = trendWallBucketStart(window.wallStart, window.granularity)
  while (wallCursor <= lastWall) {
    if (window.granularity === 'hour') {
      for (const realStart of realHourStarts(wallCursor, periods)) {
        if (realStart >= window.startMs && realStart < window.endMs && realStart <= nowMs) {
          buckets.push(realStart)
        }
      }
    } else {
      const date = new Date(wallCursor)
      const realStart = localMidnightMs(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        clock,
      )
      if (realStart <= nowMs) buckets.push(realStart)
    }
    wallCursor = nextTrendWallBucket(wallCursor, window.granularity)
  }
  return [...new Set(buckets)].sort((a, b) => a - b)
}

interface AggregatedRow {
  /** 把日志按其历史 UTC 偏移平移后的墙上小时起点。 */
  bucket: number
  offsetMs: number
  modelId: string | null
  modelLabel: string | null
  pricingSnapshot: ModelPricing | null
  requests: number
  inputTokens: number
  cacheWriteTokens: number
  cachedTokens: number
  outputTokens: number
  imageTokens: number
  totalTokens: number
  imageRequests: number
}

/**
 * 一次查询取回个人使用面板需要的全部维度。
 *
 * 分桶键是「本地日 + 本地小时」：`(created_at + offset)` 整除后再取模，
 * 沿用 `services/stats.ts` 的整除分桶思路，但改为按用户本地时间对齐——
 * 个人热力图必须和用户自己的日历一致，否则凌晨的对话会算到前一天。
 */
async function aggregate(
  userId: string,
  since: number,
  until: number,
  offsetPeriods: OffsetPeriod[],
): Promise<AggregatedRow[]> {
  let offset = sql<number>`${offsetPeriods[0]?.offsetMs ?? 0}`
  for (const period of offsetPeriods.slice(1)) {
    offset = sql<number>`case when ${usageLogs.createdAt} >= ${period.startMs} then ${period.offsetMs} else ${offset} end`
  }
  const shifted = sql<number>`(${usageLogs.createdAt} + ${offset})`
  const conditions: SQL[] = [eq(usageLogs.userId, userId), eq(usageLogs.success, true)]
  if (since > 0) conditions.push(gte(usageLogs.createdAt, new Date(since)))
  conditions.push(lt(usageLogs.createdAt, new Date(until)))

  const rows = await db
    .select({
      bucket: sql<number>`${shifted} - (${shifted} % 3600000)`,
      offsetMs: offset,
      modelId: usageLogs.modelId,
      modelLabel: usageLogs.modelLabel,
      pricingSnapshot: usageLogs.pricingSnapshot,
      requests: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens}),0)`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageLogs.cacheWriteTokens}),0)`,
      cachedTokens: sql<number>`coalesce(sum(${usageLogs.cachedTokens}),0)`,
      outputTokens: sql<number>`coalesce(sum(${usageLogs.outputTokens}),0)`,
      imageTokens: sql<number>`coalesce(sum(${usageLogs.imageTokens}),0)`,
      totalTokens: sql<number>`coalesce(sum(${usageLogs.totalTokens}),0)`,
      imageRequests: sql<number>`coalesce(sum(case when ${usageLogs.imageTokens} > 0 then 1 else 0 end),0)`,
    })
    .from(usageLogs)
    .where(and(...conditions))
    .groupBy(
      sql`${shifted} - (${shifted} % 3600000)`,
      offset,
      usageLogs.modelId,
      usageLogs.modelLabel,
      usageLogs.pricingSnapshot,
    )
  return rows as AggregatedRow[]
}

/** 连续活跃天数：从最近一天往前数；今天还没用过时也允许从昨天开始算。 */
function computeStreaks(
  activeKeys: Set<string>,
  todayKey: string,
  yesterdayKey: string,
  orderedKeys: string[],
): { currentStreak: number; longestStreak: number } {
  let longest = 0
  let running = 0
  for (const key of orderedKeys) {
    if (activeKeys.has(key)) {
      running += 1
      longest = Math.max(longest, running)
    } else {
      running = 0
    }
  }

  let current = 0
  const startIndex = activeKeys.has(todayKey)
    ? orderedKeys.indexOf(todayKey)
    : activeKeys.has(yesterdayKey)
      ? orderedKeys.indexOf(yesterdayKey)
      : -1
  if (startIndex >= 0) {
    for (let index = startIndex; index >= 0; index--) {
      if (!activeKeys.has(orderedKeys[index]!)) break
      current += 1
    }
  }
  return { currentStreak: current, longestStreak: longest }
}

/** 按模型的消费构成（管理端用户详情与个人面板共用）。 */
export async function getUserModelUsage(
  userId: string,
  days: number,
): Promise<UsageModelStatDTO[]> {
  const now = Date.now()
  const since = days > 0 ? now - days * DAY_MS : 0
  const rows = await aggregate(userId, since, now + 1, [
    { startMs: since, endMs: now + 1, offsetMs: 0 },
  ])
  return summarizeByModel(rows)
}

function summarizeByModel(rows: AggregatedRow[]): UsageModelStatDTO[] {
  const byModel = new Map<string, UsageModelStatDTO>()
  for (const row of rows) {
    const label = row.modelLabel ?? '未知模型'
    // 模型删除后 modelId 变 null，仍按名字分组；JSON 数组做复合 key，避免拼接产生歧义。
    const key = JSON.stringify([row.modelId, label])
    const entry = byModel.get(key) ?? {
      modelId: row.modelId,
      modelLabel: label,
      requests: 0,
      totalTokens: 0,
      costUsd: 0,
    }
    entry.requests += row.requests
    entry.totalTokens += row.totalTokens
    entry.costUsd += costUsd(row, row.pricingSnapshot)
    byModel.set(key, entry)
  }
  return [...byModel.values()].sort((a, b) => b.requests - a.requests)
}

/** 统计窗口内新建的对话数与消息数（与其余指标同口径，避免「花费按月、对话按终身」）。 */
async function countConversationsAndMessages(
  userId: string,
  startMs: number,
  endMs: number,
): Promise<{ conversations: number; messages: number }> {
  const [conversationRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        gte(conversations.createdAt, new Date(startMs)),
        lt(conversations.createdAt, new Date(endMs)),
      ),
    )
  const [messageRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        gte(messages.createdAt, new Date(startMs)),
        lt(messages.createdAt, new Date(endMs)),
      ),
    )
  return { conversations: conversationRow?.count ?? 0, messages: messageRow?.count ?? 0 }
}

/**
 * 个人使用情况面板的一次性数据包。
 *
 * 两条时间轴刻意分开：
 * - **窗口**（今日/本周/本月/本年）决定概览指标、趋势、分模型构成与活跃节律，全部同口径；
 * - **热力图**恒为「近一年」，与所选窗口无关，因此仍旧一眼看全年节奏。
 *
 * 只打一次用量聚合查询：起点取「窗口起点」与「热力图起点」中更早的那个，
 * 窗口内的切片在内存里按 bucket 过滤完成，多取的那一天不会污染任何总计。
 */
export async function getMyUsageStats(
  userId: string,
  options: UsageStatsOptions = {},
): Promise<UsageStatsDTO> {
  const clock = resolveUsageClock(options)
  const rangeDays = Math.max(
    7,
    Math.min(USAGE_STATS_MAX_DAYS, Math.round(options.days ?? USAGE_STATS_DEFAULT_DAYS)),
  )
  const view = options.view ?? 'month'
  const now = Date.now()
  const window = resolveUsageWindow(view, now, clock, options.weekStart ?? 'mon')
  // 热力图多取一天，避免用户本地日与 UTC 日错位时把最早那一格截掉。
  const heatmapSince = now - (rangeDays + 1) * DAY_MS
  const querySince = Math.min(heatmapSince, window.startMs)
  // 两侧多覆盖一天，让墙上小时反解真实起点时在窗口边缘也能命中所属偏移区段。
  const offsetPeriods = resolveOffsetPeriods(clock, querySince - DAY_MS, now + DAY_MS)
  const rows = await aggregate(userId, querySince, now + 1, offsetPeriods)

  const heatmapByDate = new Map<string, UsageHeatmapCellDTO>()
  const byHour = Array.from({ length: 24 }, () => 0)
  const byWeekday = Array.from({ length: 7 }, () => 0)
  const trendByBucket = new Map<number, UsageTrendPointDTO>()
  for (const bucket of trendBucketSeries(window, now, clock, offsetPeriods)) {
    trendByBucket.set(bucket, { ts: bucket, requests: 0, totalTokens: 0, costUsd: 0 })
  }
  const windowRows: AggregatedRow[] = []
  const windowActiveDates = new Set<string>()
  let requests = 0
  let totalTokens = 0
  let totalCost = 0
  let imageGenerations = 0

  for (const row of rows) {
    const cost = costUsd(row, row.pricingSnapshot)
    // bucket 已是「平移到 UTC 的本地小时起点」，因此直接按 UTC 读取即为本地时间。
    const bucketDate = new Date(row.bucket)
    const dateKey = bucketDate.toISOString().slice(0, 10)

    const cell = heatmapByDate.get(dateKey) ?? {
      date: dateKey,
      requests: 0,
      totalTokens: 0,
      costUsd: 0,
    }
    cell.requests += row.requests
    cell.totalTokens += row.totalTokens
    cell.costUsd += cost
    heatmapByDate.set(dateKey, cell)

    if (row.bucket < window.wallStart || row.bucket >= window.wallEnd) continue

    windowRows.push(row)
    if (row.requests > 0) windowActiveDates.add(dateKey)
    requests += row.requests
    totalTokens += row.totalTokens
    totalCost += cost
    imageGenerations += row.imageRequests
    const hour = bucketDate.getUTCHours()
    byHour[hour] = (byHour[hour] ?? 0) + row.requests
    byWeekday[bucketDate.getUTCDay()] = (byWeekday[bucketDate.getUTCDay()] ?? 0) + row.requests

    const wallBucketStart = trendWallBucketStart(row.bucket, window.granularity)
    const wallDate = new Date(wallBucketStart)
    const bucketStart =
      window.granularity === 'hour'
        ? (realHourStarts(wallBucketStart, offsetPeriods).find(
            (candidate) => localOffsetMs(candidate, clock) === row.offsetMs,
          ) ?? wallBucketStart - row.offsetMs)
        : localMidnightMs(
            wallDate.getUTCFullYear(),
            wallDate.getUTCMonth() + 1,
            wallDate.getUTCDate(),
            clock,
          )
    const point = trendByBucket.get(bucketStart) ?? {
      ts: bucketStart,
      requests: 0,
      totalTokens: 0,
      costUsd: 0,
    }
    point.requests += row.requests
    point.totalTokens += row.totalTokens
    point.costUsd += cost
    trendByBucket.set(bucketStart, point)
  }

  const dateKeys = dateKeySeries(now, clock, rangeDays)
  const heatmap: UsageHeatmapCellDTO[] = dateKeys.map(
    (date) => heatmapByDate.get(date) ?? { date, requests: 0, totalTokens: 0, costUsd: 0 },
  )
  // 连续活跃天数按近一年滚动计算：streak 本身就是滚动概念，跟随窗口反而会在月初归零。
  const activeKeys = new Set(
    [...heatmapByDate.entries()].filter(([, cell]) => cell.requests > 0).map(([date]) => date),
  )
  const { currentStreak, longestStreak } = computeStreaks(
    activeKeys,
    localDateKey(now, clock),
    dateKeys.at(-2) ?? '',
    dateKeys,
  )

  const counts = await countConversationsAndMessages(userId, window.startMs, window.endMs)
  const [firstUsage] = await db
    .select({ ts: sql<number | null>`min(${usageLogs.createdAt})` })
    .from(usageLogs)
    .where(eq(usageLogs.userId, userId))

  const byModel = summarizeByModel(windowRows)
  const maxHourRequests = Math.max(...byHour)
  const maxWeekdayRequests = Math.max(...byWeekday)

  return {
    view,
    windowStart: window.startMs,
    windowEnd: window.endMs,
    granularity: window.granularity,
    rangeDays,
    totals: {
      conversations: counts.conversations,
      messages: counts.messages,
      requests,
      totalTokens,
      costUsd: totalCost,
      imageGenerations,
      activeDays: windowActiveDates.size,
      currentStreak,
      longestStreak,
    },
    heatmap,
    byModel,
    byHour,
    byWeekday,
    trend: [...trendByBucket.values()].sort((a, b) => a.ts - b.ts),
    topModel: byModel[0] ?? null,
    busiestHour: maxHourRequests > 0 ? byHour.indexOf(maxHourRequests) : null,
    busiestWeekday: maxWeekdayRequests > 0 ? byWeekday.indexOf(maxWeekdayRequests) : null,
    firstUsedAt: firstUsage?.ts ?? null,
  }
}
