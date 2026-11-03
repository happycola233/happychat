import { and, desc, eq } from 'drizzle-orm'
import { DEFAULT_TITLE_PROMPT } from '@shared/constants'
import type { MessageUsage, ModelPricing, UsageOutcome } from '@shared/types/domain'
import { textFromContent } from '@shared/util/contentText'
import { summarizeArtifactBlocks } from '@shared/util/artifactBlocks'
import { calculateRequestCost, imageCostAmounts } from '@shared/util/cost'
import { freezeRunPricing } from './model-pricing'
import { isRouteFault, orderRouteCandidates, routeHealth, type RouteTarget } from './model-routes'
import { anthropicModelProfile } from '@shared/util/anthropic'
import { titleLocaleFromBrowser } from '@shared/util/titleLocale'
import { db } from '../db/client'
import { conversations, models, runs, usageLogs } from '../db/schema'
import { mapAnthropicUsage, type AnthropicUsage } from '../provider/anthropic'
import { classifyAnthropicTerminal } from '../provider/anthropic-terminal'
import { buildChatBody, mapChatUsage } from '../provider/chat'
import type { ChatChunk } from '../provider/chat'
import { classifyChatTerminal } from '../provider/chat-terminal'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import { parseResponse } from '../provider/normalize'
import {
  UpstreamResponseLatencyTracker,
  type UpstreamResponseTimingObserver,
} from '../provider/response-timing'
import { classifyResponsesTerminal } from '../provider/responses-terminal'
import { buildResponseBody } from '../provider/params'
import { buildPath, getConversationMessages } from './conversations'
import { getAppConfig } from './appConfig'
import { conversationEvents } from './conversation-events'
import { getFirstRunnableTextModel, getRunnableModel, type RunnableModel } from './models'
import { computeGenerationDurationMs } from './run-timing'

type ModelRow = typeof models.$inferSelect

/** 清洗模型输出为标题：去引号/取首行/去尾标点/限长。 */
export function cleanTitle(raw: string): string {
  let t = raw.trim()
  t = t.split('\n')[0]!.trim()
  t = t.replace(/^["'“”『「]+|["'“”』」]+$/g, '').trim()
  t = t.replace(/[。.!！?？,，、;；:：]+$/g, '').trim()
  return t.slice(0, 40)
}

async function resolveTitleModel(
  titleModelId: string | null,
  userId: string,
): Promise<RunnableModel | null> {
  if (titleModelId) {
    const preferred = await getRunnableModel(titleModelId, userId)
    if (preferred && preferred.model.kind !== 'image') return preferred
  }
  // 回退仍受当前会话所有者的模型范围约束；无可用模型时走本地标题，不做隐藏旁路调用。
  return getFirstRunnableTextModel(userId)
}

/** 标题调用的结果：正文、上游用量与终态，成功和失败都必须进入请求审计。 */
interface TitleModelResult {
  text: string
  usage: MessageUsage
  success: boolean
  errorType: string | null
  outcome: UsageOutcome
  terminalReason: string | null
}

const EMPTY_USAGE: MessageUsage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

function titleTerminalResult(terminal: {
  state: 'completed' | 'incomplete' | 'failed'
  incompleteReason: string | null
  errorType: string | null
}): Pick<TitleModelResult, 'success' | 'errorType' | 'outcome' | 'terminalReason'> {
  return {
    success: terminal.state !== 'failed',
    errorType: terminal.errorType,
    outcome: terminal.state,
    terminalReason: terminal.errorType ?? terminal.incompleteReason,
  }
}

async function callTitleModel(
  m: ModelRow,
  target: RouteTarget,
  prompt: string,
  responseTimingObserver: UpstreamResponseTimingObserver,
): Promise<TitleModelResult> {
  const client = providerClientFromRow(target.provider, responseTimingObserver)
  if (m.kind === 'chat') {
    const configuredBody = buildChatBody({ model: m, messages: [], stream: false })
    const outputParams = Object.fromEntries(
      ['max_completion_tokens', 'max_tokens', 'reasoning_effort']
        .filter((field) => configuredBody[field] !== undefined)
        .map((field) => [field, configuredBody[field]]),
    )
    const resp = (await client.createChat({
      model: target.upstreamModelId,
      messages: [{ role: 'user', content: prompt }],
      ...outputParams,
      stream: false,
    })) as {
      choices?: {
        message?: { content?: string | null; refusal?: string | null }
        finish_reason?: string | null
      }[]
      usage?: ChatChunk['usage']
    }
    const choice = resp.choices?.[0] ?? {}
    return {
      text: choice.message?.content ?? '',
      usage: mapChatUsage(resp.usage),
      ...titleTerminalResult(
        classifyChatTerminal({
          finishReason: choice.finish_reason,
          refusalObserved: Boolean(choice.message?.refusal),
        }),
      ),
    }
  }
  if (m.kind === 'anthropic') {
    const body: Record<string, unknown> = {
      model: target.upstreamModelId,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      max_tokens: 512,
    }
    const profile = anthropicModelProfile(m.modelId)
    // 标题优先使用型号允许的最低思考模式；始终自适应思考的型号用 low 并留出思考预算。
    if (profile.supportsBetweenTools) {
      body.thinking = { type: 'between_tools' }
      body.output_config = { effort: 'low' }
    } else if (profile.thinkingDefaultsOn && profile.canDisableThinking) {
      body.thinking = { type: 'disabled' }
    } else if (profile.thinkingDefaultsOn) {
      body.output_config = { effort: 'low' }
      body.max_tokens = 4096
    }
    const resp = (await client.createAnthropicMessage(body)) as {
      content?: { type?: string; text?: string }[]
      usage?: AnthropicUsage
      stop_reason?: string | null
    }
    return {
      text: (resp.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
      usage: mapAnthropicUsage(resp.usage),
      ...titleTerminalResult(classifyAnthropicTerminal(resp.stop_reason)),
    }
  }
  const configuredBody = buildResponseBody({
    model: m,
    input: [],
    instructions: null,
    stream: false,
  })
  const outputParams = Object.fromEntries(
    ['max_output_tokens', 'reasoning']
      .filter((field) => configuredBody[field] !== undefined)
      .map((field) => [field, configuredBody[field]]),
  )
  const resp = await client.createResponse({
    model: target.upstreamModelId,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    ...outputParams,
    store: false,
  })
  const parsed = parseResponse(resp)
  const terminal = classifyResponsesTerminal(resp)
  return {
    text: parsed.text,
    usage: parsed.usage,
    ...titleTerminalResult(terminal),
  }
}

/**
 * 记账标题调用的真实用量。
 *
 * 标题总结没有 run（不走 `runs` 表，也没有助手消息），因此 `run_id` 为空，
 * 靠 `kind='title'` 与对话请求区分；成本口径与 finalize 完全一致（同一份价格快照）。
 * 用户额度只聚合 `kind='chat'`，所以这里保留真实审计日志，但不写额度归属时刻。
 * 失败调用也写审计行，但标记 `success=false`；拿不到上游用量的网络/HTTP 异常以 0 记账。
 */
async function logTitleUsage(
  conversationId: string,
  userId: string,
  model: ModelRow,
  target: RouteTarget,
  costPricing: ModelPricing,
  usage: MessageUsage,
  success: boolean,
  errorType: string | null,
  outcome: UsageOutcome,
  terminalReason: string | null,
  upstreamResponseLatencyMs: number | null,
  durationMs: number | null,
  requestStartedAt: number,
): Promise<void> {
  const costBreakdown = calculateRequestCost(
    { ...usage, imageTokens: 0 },
    model.pricing,
    model.kind,
    [],
    requestStartedAt,
  )
  const upstreamCost = calculateRequestCost(
    { ...usage, imageTokens: 0 },
    costPricing,
    model.kind,
    [],
    requestStartedAt,
  )
  const imageCost = imageCostAmounts(costBreakdown)
  await db.insert(usageLogs).values({
    costUsd: costBreakdown.totalUsd,
    costCny: costBreakdown.totalCny,
    costBreakdown,
    imageCostUsd: imageCost.usd,
    imageCostCny: imageCost.cny,
    upstreamCostUsd: upstreamCost.totalUsd,
    upstreamCostCny: upstreamCost.totalCny,
    upstreamCostBreakdown: upstreamCost,
    userId,
    modelId: model.id,
    providerId: target.provider.id,
    routeId: target.route.id,
    modelLabel: target.upstreamModelId,
    modelDisplayName: model.displayName,
    providerLabel: target.provider.name,
    pricingSnapshot: model.pricing,
    conversationId,
    kind: 'title',
    inputTokens: usage.inputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cachedTokens: usage.cachedTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    durationMs,
    upstreamResponseLatencyMs,
    success,
    errorType,
    outcome,
    terminalReason,
  })
}

function titleCallError(error: unknown): { errorType: string; terminalReason: string } {
  if (error instanceof UpstreamError) {
    return {
      errorType: error.type ?? 'upstream_error',
      terminalReason: error.code ?? error.type ?? 'upstream_error',
    }
  }
  return { errorType: 'upstream_error', terminalReason: 'upstream_error' }
}

async function titleLocaleForRun(conversationId: string, runId?: string): Promise<string> {
  const [row] = await db
    .select({ requestParams: runs.requestParams })
    .from(runs)
    .where(
      runId
        ? and(eq(runs.id, runId), eq(runs.conversationId, conversationId))
        : eq(runs.conversationId, conversationId),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1)

  return titleLocaleFromBrowser(
    (row?.requestParams as { clientLocale?: unknown } | null | undefined)?.clientLocale,
  )
}

/**
 * 首条助手回复完成后异步生成标题（仅当会话尚无标题）。失败回退首条用户消息切片。
 * 在 finalizeRun 成功分支 fire-and-forget 调用。
 */
export async function maybeGenerateTitle(conversationId: string, runId?: string): Promise<void> {
  try {
    const cfg = await getAppConfig()
    if (!cfg.titleEnabled) return
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    if (!conv || conv.title) return // 已有标题（用户命名或已生成）→ 跳过

    const all = await getConversationMessages(conversationId)
    const path = buildPath(all, conv.activeLeafId)
    if (path.length === 0) return

    const firstUser = path.find((m) => m.role === 'user')
    const fallback =
      (firstUser ? textFromContent(firstUser.content).trim().slice(0, 20) : '') || '新聊天'

    const recent = path.slice(-4)
    // Artifact 源码对总结标题没有帮助，只保留「[Artifact：标题]」，把 500 字预算留给正文。
    const content = recent
      .map(
        (m) =>
          `${m.role === 'user' ? 'User' : 'Assistant'}: ${summarizeArtifactBlocks(textFromContent(m.content)).slice(0, 500)}`,
      )
      .join('\n')

    const resolved = await resolveTitleModel(cfg.titleModelId, conv.userId)
    if (!resolved) {
      const updatedAt = new Date()
      await db
        .update(conversations)
        .set({ title: fallback, updatedAt })
        .where(eq(conversations.id, conversationId))
      conversationEvents.emitTitleUpdated(conv.userId, conversationId, fallback, updatedAt)
      return
    }
    const titleLocale = await titleLocaleForRun(conversationId, runId)
    const prompt = (cfg.titlePrompt || DEFAULT_TITLE_PROMPT)
      .replaceAll('{locale}', titleLocale)
      .replaceAll('{content}', content)
    const pricing = await freezeRunPricing(
      resolved.model,
      resolved.routes.map((target) => ({
        id: target.route.id,
        costPricing: target.route.costPricing,
      })),
    )
    resolved.model.pricing = pricing.billing
    let result: TitleModelResult | null = null
    // 与对话相同的线路调度；每次上游调用各记一条审计。只有线路级故障才换下一条线路。
    for (const target of orderRouteCandidates(resolved.routes)) {
      const upstreamResponseTiming = new UpstreamResponseLatencyTracker()
      const titleStartedAt = new Date()
      let routeFault = false
      try {
        result = await callTitleModel(resolved.model, target, prompt, upstreamResponseTiming)
        routeHealth.recordSuccess(target.route.id)
      } catch (error) {
        console.error('标题模型调用失败:', error)
        const { errorType, terminalReason } = titleCallError(error)
        result = {
          text: '',
          usage: EMPTY_USAGE,
          success: false,
          errorType,
          outcome: 'failed',
          terminalReason,
        }
        routeFault =
          !(error instanceof UpstreamError) ||
          isRouteFault({
            errorType: error.type ?? null,
            errorCode: error.code ?? null,
            httpStatus: error.status || null,
          })
        if (routeFault)
          routeHealth.recordFailure(
            target.route.id,
            error instanceof Error ? error.message : '标题生成失败',
          )
      }
      await logTitleUsage(
        conversationId,
        conv.userId,
        resolved.model,
        target,
        pricing.costByRoute.get(target.route.id) ?? pricing.billing,
        result.usage,
        result.success,
        result.errorType,
        result.outcome,
        result.terminalReason,
        upstreamResponseTiming.latencyMs,
        computeGenerationDurationMs(titleStartedAt, new Date()),
        titleStartedAt.getTime(),
      )
      if (!routeFault) break
    }
    const title = (result?.success ? cleanTitle(result.text) : '') || fallback
    const updatedAt = new Date()
    await db
      .update(conversations)
      .set({ title, updatedAt })
      .where(eq(conversations.id, conversationId))
    conversationEvents.emitTitleUpdated(conv.userId, conversationId, title, updatedAt)
  } catch (e) {
    console.error('标题生成失败:', e)
  }
}
