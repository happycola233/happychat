import type { MessageUsage, ProcessStep } from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { mapChatUsage } from '../provider/chat'
import { classifyChatTerminal } from '../provider/chat-terminal'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import type { FinalizeArgs } from './finalize'
import type { EngineContext } from './types'
import { executeRun, type RunAttemptRuntime } from './execute-run'

/**
 * chat/completions 引擎：消费 chat 流，把 delta 翻译成与 Responses 一致的合成事件
 * （response.output_text.delta / response.reasoning_summary_text.delta），前端 reducer 无需改动。
 */
export async function runChatEngine(ctx: EngineContext): Promise<void> {
  await executeRun(ctx, runChatAttempt)
}

async function runChatAttempt(
  ctx: EngineContext,
  runtime: RunAttemptRuntime,
): Promise<FinalizeArgs> {
  const { startedAt, persistEmit, upstreamResponseTiming, recordError } = runtime
  persistEmit('response.created', {})
  let text = ''
  let reasoning = ''
  let usage: MessageUsage = {
    inputTokens: 0,
    cacheWriteTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
  let state: 'completed' | 'incomplete' | 'failed' | 'canceled'
  let incompleteReason: string | null = null
  let errorMessage: string | null = null
  let errorType: string | null
  let errorCode: string | null = null
  let httpStatus: number | null = null
  let finishReason: string | null = null
  let receivedDone = false
  let refusalObserved = false
  let toolCallObserved = false
  let discardPartialOutput = false
  let answerStarted = false

  try {
    const client = providerClientFromRow(ctx.provider, upstreamResponseTiming)
    for await (const event of client.createChatStream(ctx.body, ctx.abortController.signal)) {
      if (event.type === 'done') {
        receivedDone = true
        break
      }

      const chunk = event.chunk
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (delta?.reasoning_content) {
        reasoning += delta.reasoning_content
        persistEmit('response.reasoning_summary_text.delta', { delta: delta.reasoning_content })
      }
      if (delta?.content) {
        if (!answerStarted) {
          answerStarted = true
          persistEmit(RUN_EVENT_TYPE.answerStarted, {})
        }
        text += delta.content
        persistEmit('response.output_text.delta', { delta: delta.content })
      }
      if (chunk.usage) usage = mapChatUsage(chunk.usage)

      if (typeof delta?.refusal === 'string' && delta.refusal.length > 0) {
        refusalObserved = true
      } else if (
        (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) ||
        (delta?.function_call !== undefined && delta.function_call !== null)
      ) {
        toolCallObserved = true
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason
    }

    if (ctx.abortController.signal.aborted) {
      state = 'canceled'
      incompleteReason = null
      errorMessage = null
      errorType = null
      errorCode = null
      httpStatus = null
      discardPartialOutput = false
    } else {
      const terminal = classifyChatTerminal({
        finishReason,
        refusalObserved,
        toolCallObserved,
        doneObserved: receivedDone,
      })
      state = terminal.state
      incompleteReason = terminal.incompleteReason
      errorType = terminal.errorType
      discardPartialOutput = terminal.discardPartialOutput

      if (terminal.errorType === 'refusal') {
        errorMessage = '模型拒绝了此请求，请调整内容后重试。'
      } else if (terminal.errorType === 'content_filter') {
        errorMessage = '上游内容过滤器终止了生成，请调整内容后重试。'
      } else if (terminal.errorType === 'tool_calls') {
        errorMessage = '模型请求了本站不支持的客户端工具，生成已停止。'
      } else if (terminal.errorType === 'unsupported_finish_reason') {
        errorMessage = `上游返回了不支持的结束原因：${finishReason}`
      } else if (terminal.errorType === 'invalid_response') {
        // 非流标题保留 invalid_response；流式 EOF 则沿用更具体的传输层原因。
        errorType = 'incomplete_stream'
        errorMessage = '上游响应在终止标记前结束'
      }
    }
  } catch (e) {
    if (ctx.abortController.signal.aborted) {
      state = 'canceled'
      incompleteReason = null
      errorMessage = null
      errorType = null
      errorCode = null
      httpStatus = null
      discardPartialOutput = false
    } else {
      const ue = e instanceof UpstreamError ? e : null
      recordError(ue)
      state = 'failed'
      errorMessage = ue?.message ?? (e instanceof Error ? e.message : '生成失败')
      errorType = ue?.type ?? null
      errorCode = ue?.code ?? null
      httpStatus = ue?.status ?? null
    }
  }

  if (refusalObserved || (toolCallObserved && (state === 'failed' || state === 'canceled'))) {
    state = 'failed'
    errorType = refusalObserved ? 'refusal' : 'tool_calls'
    errorCode = null
    errorMessage = refusalObserved
      ? '模型拒绝了此请求，请调整内容后重试。'
      : '模型请求了本站不支持的客户端工具，生成已停止。'
    discardPartialOutput = refusalObserved
  }

  if (discardPartialOutput) {
    text = ''
    reasoning = ''
  }

  return {
    run: ctx.run,
    assistantMessage: ctx.assistantMessage,
    conversation: ctx.conversation,
    model: ctx.model,
    provider: ctx.provider,
    state,
    text,
    ...(discardPartialOutput ? { content: [] } : {}),
    processSteps: discardPartialOutput
      ? []
      : reasoning
        ? ([{ kind: 'reasoning', text: reasoning }] satisfies ProcessStep[])
        : [],
    annotations: [],
    usage,
    incompleteReason,
    errorMessage,
    errorType,
    errorCode,
    httpStatus,
    discardPartialOutput,
    upstreamResponseId: null,
    startedAt,
    upstreamResponseLatencyMs: upstreamResponseTiming.latencyMs,
    persistEmit,
  }
}
