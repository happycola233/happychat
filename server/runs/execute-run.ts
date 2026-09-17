import { and, eq, inArray } from 'drizzle-orm'
import type { ModelParams } from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import type { RetryAttemptFailure, RetryFailureStage } from '@shared/types/retry'
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
import { runEmitter } from './emitter'
import {
  collectProviderOpaqueStrings,
  redactProviderOpaqueContent,
  sanitizeEventData,
} from './event-sanitize'
import { finalizeRun, type FinalizeArgs } from './finalize'
import { removeGeneratedImageAttachments } from './generated-images'
import type { EngineContext } from './types'

export interface RunAttemptRuntime {
  startedAt: Date
  persistEmit: (type: string, data: Record<string, unknown>, observedAt?: Date) => number
  upstreamResponseTiming: UpstreamResponseTimingObserver & { readonly latencyMs: number | null }
  recordError: (error: UpstreamError | null, sensitiveValues?: readonly string[]) => void
}

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

/**
 * 一次用户生成只有一个 run、一个结算入口和一份重试预算。
 * 各次尝试使用全新的协议累积器；新输出到达前保留旧内容，避免失败重连把回答清空。
 */
export async function executeRun(
  ctx: EngineContext,
  executeAttempt: (ctx: EngineContext, runtime: RunAttemptRuntime) => Promise<FinalizeArgs>,
): Promise<void> {
  const policy = (await getAppConfig()).upstreamRetry
  const startedAt = new Date()
  const deadline = startedAt.getTime() + policy.maxElapsedSeconds * 1000
  const timing = new UpstreamResponseLatencyTracker()
  const sensitiveContent = new Set(collectProviderOpaqueStrings(ctx.body))
  let sequence = 0
  const emit = (type: string, data: Record<string, unknown>, observedAt = new Date()): number => {
    collectProviderOpaqueStrings(data).forEach((value) => sensitiveContent.add(value))
    const sanitizedData = sanitizeEventData(type, data, [...sensitiveContent])
    const sequenceNumber = sequence++
    db.insert(runEvents)
      .values({
        runId: ctx.run.id,
        sequenceNumber,
        type,
        data: sanitizedData,
        createdAt: observedAt,
      })
      .run()
    db.update(runs).set({ lastSequenceNumber: sequenceNumber }).where(eq(runs.id, ctx.run.id)).run()
    runEmitter.emit({
      runId: ctx.run.id,
      sequenceNumber,
      type,
      data: sanitizedData,
      createdAt: observedAt,
    })
    return sequenceNumber
  }
  emit(RUN_EVENT_TYPE.created, {
    runId: ctx.run.id,
    conversationId: ctx.conversation.id,
    assistantMessageId: ctx.assistantMessage.id,
    startedAt: startedAt.getTime(),
    reasoningEnabled: isReasoningEnabled(ctx.model, ctx.run.requestParams as ModelParams | null),
  })
  db.update(runs).set({ state: 'running', startedAt }).where(eq(runs.id, ctx.run.id)).run()

  const failures: RetryAttemptFailure[] = []
  let attempt = 1
  let visibleResult: FinalizeArgs | null = null
  let visibleAttachments = new Set<string>()
  let totalUsage: FinalizeArgs['usage'] | null = null
  let totalImageTokens = 0
  let result: FinalizeArgs

  for (;;) {
    const attemptStartedAt = new Date()
    const controller = new AbortController()
    const cancel = () => controller.abort(ctx.abortController.signal.reason)
    if (ctx.abortController.signal.aborted) cancel()
    else ctx.abortController.signal.addEventListener('abort', cancel, { once: true })
    let cancelTimeout: (() => void) | undefined
    let timedOut: 'first_output_timeout' | 'stream_idle_timeout' | null = null
    let receivedHeaders = false
    let responseHttpStatus: number | null = null
    let outputObserved = false
    let committed = attempt === 1
    let requestStarted = false
    let retryAfter = 0
    let rawErrorMessage: string | undefined
    const pending: PendingEvent[] = []
    const attachments = new Set<string>()
    const previousStage = failures.at(-1)?.stage
    if (attempt > 1)
      emit(RUN_EVENT_TYPE.retry, {
        phase: 'attempting',
        attempt,
        maxAttempts: policy.maxRetries + 1,
        nextRetryAt: null,
        stage: previousStage,
        reason: '正在重新生成',
      })

    const armTimeout = () => {
      cancelTimeout?.()
      if (!policy.enabled || (outputObserved && policy.streamIdleTimeoutSeconds === 0)) return
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
              eq(runEvents.runId, ctx.run.id),
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
        armTimeout()
        commit()
        if (attempt > 1 && firstOutput)
          emit(RUN_EVENT_TYPE.retry, {
            phase: 'connected',
            attempt,
            maxAttempts: policy.maxRetries + 1,
            nextRetryAt: null,
            stage: previousStage,
            reason: '已恢复生成',
          })
      }
      if (committed) return emit(type, data, observedAt)
      pending.push({ type, data, observedAt })
      return -1
    }

    try {
      result = await executeAttempt(
        { ...ctx, abortController: controller },
        {
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
              if (!requestStarted) {
                requestStarted = true
                armTimeout()
              }
            },
            onResponseHeaders(sample) {
              receivedHeaders = sample.ok
              responseHttpStatus = sample.status ?? null
              timing.onResponseHeaders(sample)
            },
            get latencyMs() {
              return timing.latencyMs
            },
          },
        },
      )
    } finally {
      cancelTimeout?.()
      ctx.abortController.signal.removeEventListener('abort', cancel)
    }

    if (timedOut && result.state === 'canceled' && !ctx.abortController.signal.aborted) {
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
    if (ctx.abortController.signal.aborted)
      result = { ...result, state: 'canceled', errorMessage: null }
    totalUsage = totalUsage ? addMessageUsage(totalUsage, result.usage) : result.usage
    totalImageTokens += result.imageTokens ?? 0
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

    if (result.state !== 'failed') break
    const stage: RetryFailureStage = outputObserved
      ? 'after_output'
      : receivedHeaders
        ? 'before_output'
        : 'connecting'
    const { delayMs, stopReason } = retryDecision(
      policy,
      {
        status: result.httpStatus ?? -1,
        type: result.errorType ?? undefined,
        code: result.errorCode ?? undefined,
      },
      attempt,
      deadline,
      stage,
      retryAfter,
    )
    const failure: RetryAttemptFailure = {
      attempt,
      stage,
      failedAt: Date.now(),
      errorType: result.errorType ?? null,
      errorCode: result.errorCode ?? null,
      httpStatus: responseHttpStatus ?? (result.httpStatus || null),
      message: redactProviderOpaqueContent(result.errorMessage ?? '生成失败', [
        ...sensitiveContent,
      ]),
      ...(rawErrorMessage
        ? {
            rawMessage: redactProviderOpaqueContent(rawErrorMessage, [...sensitiveContent]).slice(
              0,
              8192,
            ),
          }
        : {}),
      nextRetryAt: stopReason ? null : Date.now() + delayMs,
      stopReason,
    }
    failures.push(failure)
    if (stopReason) break
    emit(RUN_EVENT_TYPE.retry, {
      phase: 'waiting',
      attempt: attempt + 1,
      maxAttempts: policy.maxRetries + 1,
      nextRetryAt: failure.nextRetryAt,
      stage,
      reason:
        stage === 'after_output'
          ? '生成中断，稍后重新生成'
          : stage === 'before_output'
            ? '尚未收到输出，稍后重试'
            : '暂时无法开始生成',
    })
    try {
      await waitForRetry(delayMs, ctx.abortController.signal)
    } catch {
      failure.stopReason = 'canceled'
      result = { ...result, state: 'canceled', errorMessage: null }
      break
    }
    if (Date.now() >= deadline) {
      failure.stopReason = 'budget_exhausted'
      break
    }
    attempt += 1
  }

  const visible = visibleResult ?? result
  await finalizeRun({
    ...result,
    text: visible.text,
    content: visible.content,
    processSteps: visible.processSteps,
    annotations: visible.annotations,
    providerReplayContext: visible.providerReplayContext,
    usage: totalUsage!,
    imageTokens: totalImageTokens,
    startedAt,
    upstreamResponseLatencyMs: timing.latencyMs,
    persistEmit: emit,
    retrySummary: failures.length ? { attempts: attempt, outcome: result.state, failures } : null,
  })
}
