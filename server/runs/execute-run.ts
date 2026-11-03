import { and, eq, inArray } from 'drizzle-orm'
import type { ModelParams, RequestCostBreakdown } from '@shared/types/domain'
import { RUN_EVENT_TYPE, type RetryFailureNotice, type RunRetryData } from '@shared/types/events'
import type { RetryAttemptFailure, RetryFailureStage } from '@shared/types/retry'
import type { RunProgress } from '@shared/types/run-progress'
import { calculateRequestCost, mergeRequestCosts } from '@shared/util/cost'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { db } from '../db/client'
import { runEvents, runs } from '../db/schema'
import { addMessageUsage } from '../provider/usage'
import type { UpstreamError } from '../provider/errors'
import { retryDecision, scheduleLongTimeout, waitForRetry } from '../provider/retry'
import {
  UpstreamResponseLatencyTracker,
  type UpstreamResponseTimingObserver,
} from '../provider/response-timing'
import { getAppConfig } from '../services/appConfig'
import { isRouteFault, routeHealth } from '../services/model-routes'
import { requestMonitorEvents } from '../services/request-monitor-events'
import { resolveModelPricing } from '../services/model-pricing'
import { runEmitter } from './emitter'
import {
  collectProviderOpaqueStrings,
  redactProviderOpaqueContent,
} from '../provider/opaque-content'
import { sanitizeEventData } from './event-sanitize'
import { finalizeRun, type AttemptResult } from './finalize'
import { removeGeneratedImageAttachments } from './generated-images'
import type { EngineContext, RunExecution, RunRoute } from './types'
import { saveRunErrorAudit } from './error-audit'

export interface RunAttemptRuntime {
  startedAt: Date
  persistEmit: (type: string, data: Record<string, unknown>, observedAt?: Date) => number
  upstreamResponseTiming: UpstreamResponseTimingObserver & { readonly latencyMs: number | null }
  /** 记录本次尝试的 Retry-After 与诊断原文；流内终态错误没有 UpstreamError，只传原文。 */
  recordError: (
    error: Partial<Pick<UpstreamError, 'retryAfterMs' | 'rawMessage'>> | null,
    sensitiveValues?: readonly string[],
  ) => void
}

/** 协议引擎实现的单次尝试；返回值交给编排器决定重试、换线路或结算。 */
export type RunAttempt = (ctx: EngineContext, runtime: RunAttemptRuntime) => Promise<AttemptResult>

/** 连接通知和空占位不算输出；思考、检索进展和图片同正文一样属于已经展示的内容。 */
function isOutput(type: string, data: Record<string, unknown>): boolean {
  if (
    [
      'response.output_text.delta',
      'response.reasoning_summary_text.delta',
      'response.reasoning_text.delta',
    ].includes(type)
  ) {
    return typeof data.delta === 'string' && data.delta.length > 0
  }
  return (
    type === RUN_EVENT_TYPE.outputItemReclassified ||
    type === 'image.generation.partial' ||
    type === 'image.generation.completed' ||
    type === 'response.web_search_call.searching' ||
    (type === 'response.output_item.done' &&
      ['web_search_call', 'custom_tool_call'].includes(
        String((data.item as { type?: string } | undefined)?.type),
      ))
  )
}

type PendingEvent = { type: string; data: Record<string, unknown>; observedAt: Date }

/** 重试提示只携带已脱敏的用户文案与结构化标识；诊断原文仍只进入审计。 */
function retryFailureNotice(failure: RetryAttemptFailure): RetryFailureNotice {
  return {
    message: failure.message,
    errorType: failure.errorType,
    errorCode: failure.errorCode,
    httpStatus: failure.httpStatus,
    failedAt: failure.failedAt,
  }
}

/**
 * 一次用户生成只有一个 run、一个结算入口和一份重试预算。
 * 各次尝试使用全新的协议累积器；新输出到达前保留旧内容，避免失败重连把回答清空。
 *
 * 线路调度：候选线路按 prepare 阶段排好的顺序依次尝试。线路级故障（见 isRouteFault）
 * 立即切换到本轮尚未尝试的下一条线路，不等待、不占重试次数；本轮线路都失败后才按
 * 自动重试策略退避，并以最新熔断状态重新开始一轮。只有一条线路时与单供应商行为一致。
 */
export async function executeRun(
  execution: RunExecution,
  executeAttempt: RunAttempt,
): Promise<void> {
  const model = { ...execution.model, pricing: resolveModelPricing(execution.model) }
  const { candidates } = execution.routing
  const policy = (await getAppConfig()).upstreamRetry
  const startedAt = new Date()
  const deadline = startedAt.getTime() + policy.maxElapsedSeconds * 1000
  const timing = new UpstreamResponseLatencyTracker()
  const sensitiveContent = new Set<string>()
  // 每条线路的请求体只在实际尝试时构建；其中的私有密文同样参与日志脱敏。
  const attemptContext = (route: RunRoute, abortController: AbortController): EngineContext => {
    const body = execution.routing.bodyFor(route)
    collectProviderOpaqueStrings(body).forEach((value) => sensitiveContent.add(value))
    return {
      ...execution,
      model: { ...model, modelId: route.upstreamModelId },
      route,
      provider: route.provider,
      body,
      abortController,
    }
  }
  let sequence = 0
  const emit = (type: string, data: Record<string, unknown>, observedAt = new Date()): number => {
    collectProviderOpaqueStrings(data).forEach((value) => sensitiveContent.add(value))
    const sanitizedData = sanitizeEventData(type, data, [...sensitiveContent])
    const sequenceNumber = sequence++
    db.insert(runEvents)
      .values({
        runId: execution.run.id,
        sequenceNumber,
        type,
        data: sanitizedData,
        createdAt: observedAt,
      })
      .run()
    db.update(runs)
      .set({ lastSequenceNumber: sequenceNumber })
      .where(eq(runs.id, execution.run.id))
      .run()
    runEmitter.emit({
      runId: execution.run.id,
      sequenceNumber,
      type,
      data: sanitizedData,
      createdAt: observedAt,
    })
    return sequenceNumber
  }
  emit(RUN_EVENT_TYPE.created, {
    runId: execution.run.id,
    conversationId: execution.conversation.id,
    assistantMessageId: execution.assistantMessage.id,
    startedAt: startedAt.getTime(),
    reasoningEnabled: isReasoningEnabled(model, execution.run.requestParams as ModelParams | null),
  })
  db.update(runs).set({ state: 'running', startedAt }).where(eq(runs.id, execution.run.id)).run()

  const rounds = policy.enabled ? policy.maxRetries + 1 : 1
  const maxAttempts = rounds * candidates.length
  // 每轮按最新熔断状态重排（稳定排序，保留 prepare 阶段的优先级与权重顺序）。
  const roundOrder = () =>
    [...candidates].sort(
      (a, b) =>
        Number(routeHealth.isCooling(a.route.id)) - Number(routeHealth.isCooling(b.route.id)),
    )
  let round = 1
  let roundRoutes = candidates
  let routeIndex = 0
  let route = candidates[0]!

  const failures: RetryAttemptFailure[] = []
  const upstreamCosts: RequestCostBreakdown[] = []
  let attempt = 1
  let visibleResult: AttemptResult | null = null
  let visibleAttachments = new Set<string>()
  let totalUsage: AttemptResult['usage'] | null = null
  let totalImageTokens = 0
  const imageUsage: NonNullable<AttemptResult['imageUsage']> = []
  let result: AttemptResult
  const routeProgress = (target: RunRoute) => ({
    modelLabel: target.upstreamModelId,
    providerId: target.provider.id,
    providerLabel: target.provider.name,
    routeId: target.route.id,
  })
  let progress: RunProgress = {
    phase: 'connecting',
    attempt: 1,
    maxAttempts,
    requestStartedAt: null,
    updatedAt: startedAt.getTime(),
    nextRetryAt: null,
    upstreamResponseLatencyMs: null,
    modelDisplayName: model.displayName,
    ...routeProgress(route),
  }
  // 只在阶段切换时写轻量快照并通知管理端，不为每个 delta 增加写入或刷新。
  const saveProgress = (patch: Partial<RunProgress>) => {
    progress = { ...progress, ...patch, updatedAt: Date.now() }
    db.update(runs).set({ progress }).where(eq(runs.id, execution.run.id)).run()
    requestMonitorEvents.notify()
  }
  const saveRunningError = () => {
    saveRunErrorAudit(db, execution.run.id, execution.run.userId, {
      attempts: attempt,
      outcome: 'running',
      failures,
    })
    requestMonitorEvents.notify()
  }

  for (;;) {
    const attemptStartedAt = new Date()
    saveProgress({
      phase: 'connecting',
      attempt,
      requestStartedAt: null,
      nextRetryAt: null,
      ...routeProgress(route),
    })
    const controller = new AbortController()
    const cancel = () => controller.abort(execution.abortController.signal.reason)
    if (execution.abortController.signal.aborted) cancel()
    else execution.abortController.signal.addEventListener('abort', cancel, { once: true })
    let cancelTimeout: (() => void) | undefined
    let timedOut: 'first_output_timeout' | 'stream_idle_timeout' | null = null
    let receivedHeaders = false
    let responseHttpStatus: number | null = null
    let outputObserved = false
    let committed = attempt === 1
    let attemptRequestStartedAt: number | null = null
    let retryAfter = 0
    let rawErrorMessage: string | undefined
    const pending: PendingEvent[] = []
    const attachments = new Set<string>()
    const previousFailure = failures.at(-1)
    const previousStage = previousFailure?.stage
    // 还有备用线路时，即使未开启自动重试也启用等待超时，否则卡死的线路永远不会切走。
    const timeoutsEnabled = policy.enabled || routeIndex < roundRoutes.length - 1
    if (previousFailure)
      emit(RUN_EVENT_TYPE.retry, {
        phase: 'attempting',
        attempt,
        maxAttempts,
        nextRetryAt: null,
        stage: previousStage,
        lastFailure: retryFailureNotice(previousFailure),
      } satisfies RunRetryData)

    const armTimeout = () => {
      cancelTimeout?.()
      if (!timeoutsEnabled || (outputObserved && policy.streamIdleTimeoutSeconds === 0)) return
      const duration = outputObserved
        ? policy.streamIdleTimeoutSeconds * 1000
        : Math.min(policy.attemptTimeoutSeconds * 1000, Math.max(0, deadline - Date.now()))
      cancelTimeout = scheduleLongTimeout(() => {
        timedOut = outputObserved ? 'stream_idle_timeout' : 'first_output_timeout'
        controller.abort()
      }, duration)
    }
    const commit = () => {
      if (committed) return
      committed = true
      // 旧图片只在新尝试确实接管显示时删除；失败或取消等待仍能保留原半成品。
      if (visibleAttachments.size) {
        removeGeneratedImageAttachments([...visibleAttachments])
        const imageEvents = db
          .select({ id: runEvents.id, data: runEvents.data })
          .from(runEvents)
          .where(
            and(
              eq(runEvents.runId, execution.run.id),
              inArray(runEvents.type, ['image.generation.partial', 'image.generation.completed']),
            ),
          )
          .all()
        for (const event of imageEvents) {
          if (!visibleAttachments.has(String(event.data.attachmentId))) continue
          db.update(runEvents)
            .set({ data: { ...event.data, attachmentId: null, attachmentDeleted: true } })
            .where(eq(runEvents.id, event.id))
            .run()
        }
      }
      visibleResult = null
      visibleAttachments = new Set()
      emit(RUN_EVENT_TYPE.outputReset, { attempt, startedAt: attemptStartedAt.getTime() })
      for (const event of pending) emit(event.type, event.data, event.observedAt)
      pending.length = 0
    }
    // 在进入缓冲前冻结时间；Chat/Anthropic 的合成事件同样按实际发生时间计时。
    const persistEmit: RunAttemptRuntime['persistEmit'] = (type, data, observedAt = new Date()) => {
      collectProviderOpaqueStrings(data).forEach((value) => sensitiveContent.add(value))
      if (type.startsWith('image.generation.') && typeof data.attachmentId === 'string')
        attachments.add(data.attachmentId)
      if (isOutput(type, data)) {
        const firstOutput = !outputObserved
        outputObserved = true
        if (firstOutput) saveProgress({ phase: 'streaming' })
        armTimeout()
        commit()
        if (attempt > 1 && firstOutput)
          emit(RUN_EVENT_TYPE.retry, {
            phase: 'connected',
            attempt,
            maxAttempts,
            nextRetryAt: null,
            stage: previousStage,
          } satisfies RunRetryData)
      }
      if (committed) return emit(type, data, observedAt)
      pending.push({ type, data, observedAt })
      return -1
    }

    try {
      result = await executeAttempt(attemptContext(route, controller), {
        startedAt,
        persistEmit,
        recordError: (error, sensitiveValues = []) => {
          // 协议引擎可能消费了未下发的私有字段，诊断原文也必须使用同一脱敏集合。
          sensitiveValues.forEach((value) => sensitiveContent.add(value))
          retryAfter = error?.retryAfterMs ?? 0
          rawErrorMessage = error?.rawMessage
        },
        upstreamResponseTiming: {
          onRequestStart(at) {
            timing.onRequestStart(at)
            if (attemptRequestStartedAt === null) {
              attemptRequestStartedAt = at
              saveProgress({ requestStartedAt: at })
              if (previousFailure) {
                previousFailure.retriedAt = at
                saveRunningError()
              }
              armTimeout()
            }
          },
          onResponseHeaders(sample) {
            receivedHeaders = sample.ok
            responseHttpStatus = sample.status ?? null
            timing.onResponseHeaders(sample)
            saveProgress({
              phase: outputObserved ? 'streaming' : sample.ok ? 'waiting_output' : 'connecting',
              upstreamResponseLatencyMs: timing.latencyMs,
            })
          },
          get latencyMs() {
            return timing.latencyMs
          },
        },
      })
    } finally {
      cancelTimeout?.()
      execution.abortController.signal.removeEventListener('abort', cancel)
    }

    if (timedOut && result.state === 'canceled' && !execution.abortController.signal.aborted) {
      result = {
        ...result,
        state: 'failed',
        httpStatus: null,
        errorType: timedOut,
        errorCode: null,
        errorMessage:
          timedOut === 'first_output_timeout' ? '等待首次输出超时。' : '上游长时间未继续输出。',
      }
    }
    if (execution.abortController.signal.aborted)
      result = { ...result, state: 'canceled', errorMessage: null }
    const attemptAt = attemptRequestStartedAt ?? attemptStartedAt.getTime()
    result.usage.billingSegments ??= [{ ...result.usage, startedAt: attemptAt }]
    const attemptImageUsage = (result.imageUsage ?? []).map((usage) => ({
      ...usage,
      startedAt: attemptAt,
    }))
    totalUsage = totalUsage ? addMessageUsage(totalUsage, result.usage) : result.usage
    totalImageTokens += result.imageTokens ?? 0
    imageUsage.push(...attemptImageUsage)
    // 上游成本按本次实际所走线路的成本价单独结算，故障转移的多条线路分别计价后相加。
    upstreamCosts.push(
      calculateRequestCost(
        {
          billingSegments: result.usage.billingSegments,
          inputTokens: result.usage.inputTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
          cachedTokens: result.usage.cachedTokens,
          outputTokens: result.usage.outputTokens,
          imageTokens: result.imageTokens ?? 0,
        },
        route.costPricing ?? model.pricing,
        model.kind,
        attemptImageUsage,
        attemptAt,
      ),
    )
    // 成功的空回答及明确拒绝也必须替换旧内容；普通失败且没有新输出时保留上次内容。
    if (
      result.state === 'completed' ||
      result.state === 'incomplete' ||
      result.discardPartialOutput
    )
      commit()
    if (committed) {
      visibleResult = result
      visibleAttachments = attachments
    }

    if (result.state === 'completed' || result.state === 'incomplete')
      routeHealth.recordSuccess(route.route.id)
    if (result.state !== 'failed') break
    const stage: RetryFailureStage = outputObserved
      ? 'after_output'
      : receivedHeaders
        ? 'before_output'
        : 'connecting'
    const httpStatus = responseHttpStatus ?? (result.httpStatus || null)
    const message = redactProviderOpaqueContent(result.errorMessage ?? '生成失败', [
      ...sensitiveContent,
    ])
    const routeFault = isRouteFault({
      errorType: result.errorType ?? null,
      errorCode: result.errorCode ?? null,
      httpStatus: result.httpStatus ?? null,
    })
    if (routeFault) routeHealth.recordFailure(route.route.id, message)
    // 换线路相当于重新生成：输出开始后是否允许，与同线路重试共用「输出后重试」开关。
    const failover =
      routeFault &&
      routeIndex < roundRoutes.length - 1 &&
      !(stage === 'after_output' && !policy.retryAfterOutput) &&
      Date.now() < deadline
    const decision = failover
      ? { delayMs: 0, stopReason: null }
      : retryDecision(
          policy,
          {
            status: result.httpStatus ?? -1,
            type: result.errorType ?? undefined,
            code: result.errorCode ?? undefined,
          },
          round,
          deadline,
          stage,
          retryAfter,
        )
    const failure: RetryAttemptFailure = {
      attempt,
      stage,
      routeId: route.route.id,
      providerId: route.provider.id,
      providerLabel: route.provider.name,
      upstreamModelId: route.upstreamModelId,
      requestStartedAt: attemptRequestStartedAt,
      failedAt: Date.now(),
      errorType: result.errorType ?? null,
      errorCode: result.errorCode ?? null,
      httpStatus,
      message,
      ...(rawErrorMessage
        ? {
            rawMessage: redactProviderOpaqueContent(rawErrorMessage, [...sensitiveContent]).slice(
              0,
              8192,
            ),
          }
        : {}),
      nextRetryAt: decision.stopReason ? null : Date.now() + decision.delayMs,
      stopReason: decision.stopReason,
      ...(decision.stopReason ? {} : { nextAction: failover ? 'failover' : 'retry' }),
    }
    failures.push(failure)
    saveRunningError()
    if (decision.stopReason) break
    attempt += 1
    if (failover) {
      routeIndex += 1
      route = roundRoutes[routeIndex]!
      continue
    }
    saveProgress({ phase: 'retry_wait', nextRetryAt: failure.nextRetryAt })
    emit(RUN_EVENT_TYPE.retry, {
      phase: 'waiting',
      attempt,
      maxAttempts,
      nextRetryAt: failure.nextRetryAt,
      stage,
      lastFailure: retryFailureNotice(failure),
    } satisfies RunRetryData)
    try {
      await waitForRetry(decision.delayMs, execution.abortController.signal)
    } catch {
      failure.stopReason = 'canceled'
      delete failure.nextAction
      result = { ...result, state: 'canceled', errorMessage: null }
      attempt -= 1
      break
    }
    if (Date.now() >= deadline) {
      failure.stopReason = 'budget_exhausted'
      delete failure.nextAction
      attempt -= 1
      break
    }
    round += 1
    roundRoutes = roundOrder()
    routeIndex = 0
    route = roundRoutes[0]!
  }

  const visible = visibleResult ?? result
  await finalizeRun({
    ...result,
    model,
    route,
    text: visible.text,
    content: visible.content,
    processSteps: visible.processSteps,
    annotations: visible.annotations,
    providerReplayContext: visible.providerReplayContext,
    usage: totalUsage!,
    imageTokens: totalImageTokens,
    imageUsage,
    upstreamCost: mergeRequestCosts(upstreamCosts),
    startedAt,
    upstreamResponseLatencyMs: timing.latencyMs,
    persistEmit: emit,
    retrySummary: failures.length ? { attempts: attempt, outcome: result.state, failures } : null,
  })
}
