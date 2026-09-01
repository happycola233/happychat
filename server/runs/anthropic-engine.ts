import { eq } from 'drizzle-orm'
import type { MessageUsage, ModelParams, SearchAction, UrlCitation } from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { joinReasoningSummaryParts } from '@shared/util/reasoningSummary'
import { db } from '../db/client'
import { runEvents, runs } from '../db/schema'
import {
  addMessageUsage,
  anthropicCitation,
  mapAnthropicUsage,
  type AnthropicContentBlock,
  type AnthropicMessage,
} from '../provider/anthropic'
import { AnthropicStreamAccumulator } from '../provider/anthropic-stream'
import { classifyAnthropicTerminal } from '../provider/anthropic-terminal'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import type { AnthropicReplayContextV1 } from '../provider/reasoning-replay'
import { UpstreamResponseLatencyTracker } from '../provider/response-timing'
import { runEmitter } from './emitter'
import { collectProviderOpaqueStrings, redactProviderOpaqueContent } from './event-sanitize'
import { finalizeRun } from './finalize'
import type { EngineContext } from './types'

const MAX_PAUSE_TURN_CONTINUATIONS = 8

const EMPTY_USAGE: MessageUsage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

function continuationMessages(body: Record<string, unknown>): AnthropicMessage[] {
  if (!Array.isArray(body.messages)) {
    throw new Error('Anthropic Messages 请求体中的 messages 必须是数组')
  }
  return body.messages as AnthropicMessage[]
}

function replayContext(
  ctx: EngineContext,
  content: AnthropicContentBlock[],
): AnthropicReplayContextV1 | null {
  if (!ctx.model.replayProviderContext || content.length === 0) return null
  return {
    version: 1,
    protocol: 'anthropic_messages',
    source: {
      providerId: ctx.provider.id,
      providerBaseUrl: ctx.provider.baseUrl,
      upstreamModelId: ctx.model.modelId,
    },
    content,
  }
}

function hasUnresolvedToolUse(content: AnthropicContentBlock[]): boolean {
  const resolvedServerToolIds = new Set(
    content.flatMap((block) =>
      typeof block.type === 'string' &&
      block.type.endsWith('_tool_result') &&
      typeof block.tool_use_id === 'string'
        ? [block.tool_use_id]
        : [],
    ),
  )
  return content.some(
    (block) =>
      block.type === 'tool_use' ||
      (block.type === 'server_tool_use' &&
        typeof block.id === 'string' &&
        !resolvedServerToolIds.has(block.id)),
  )
}

/** Anthropic Messages 引擎：原生消费 block SSE，并翻译成本站统一事件协议。 */
export async function runAnthropicEngine(ctx: EngineContext): Promise<void> {
  const sensitiveProviderContent = new Set(collectProviderOpaqueStrings(ctx.body))
  let seq = 0
  const persistEmit = (type: string, data: Record<string, unknown>): number => {
    const sequenceNumber = seq++
    db.insert(runEvents).values({ runId: ctx.run.id, sequenceNumber, type, data }).run()
    db.update(runs).set({ lastSequenceNumber: sequenceNumber }).where(eq(runs.id, ctx.run.id)).run()
    runEmitter.emit({ runId: ctx.run.id, sequenceNumber, type, data })
    return sequenceNumber
  }

  const startedAt = new Date()
  const upstreamResponseTiming = new UpstreamResponseLatencyTracker()
  persistEmit(RUN_EVENT_TYPE.created, {
    runId: ctx.run.id,
    conversationId: ctx.conversation.id,
    assistantMessageId: ctx.assistantMessage.id,
    startedAt: startedAt.getTime(),
    reasoningEnabled: isReasoningEnabled(ctx.model, ctx.run.requestParams as ModelParams | null),
  })
  db.update(runs).set({ state: 'running', startedAt }).where(eq(runs.id, ctx.run.id)).run()
  persistEmit('response.created', {})

  let text = ''
  let reasoning = ''
  let previousReasoningPart: string | null = null
  const annotations: UrlCitation[] = []
  let searchActions: SearchAction[] = []
  let usage = { ...EMPTY_USAGE }
  let state: 'completed' | 'incomplete' | 'failed' | 'canceled'
  let incompleteReason: string | null = null
  let errorMessage: string | null = null
  let errorType: string | null = null
  let errorCode: string | null = null
  let httpStatus: number | null = null
  let upstreamResponseId: string | null = null
  let discardPartialOutput = false
  const rawContent: AnthropicContentBlock[] = []
  const searchActionById = new Map<string, SearchAction>()
  const searchOutputIndexById = new Map<string, number>()

  try {
    const client = providerClientFromRow(ctx.provider, upstreamResponseTiming)
    let requestBody = ctx.body
    let messages = continuationMessages(requestBody)
    let finalStopReason: string | null

    for (let continuation = 0; ; continuation++) {
      const accumulator = new AnthropicStreamAccumulator()
      const textOffset = text.length

      for await (const event of client.createAnthropicMessageStream(
        requestBody,
        ctx.abortController.signal,
      )) {
        collectProviderOpaqueStrings(event.data).forEach((value) =>
          sensitiveProviderContent.add(value),
        )
        for (const effect of accumulator.accept(event)) {
          if (effect.type === 'text') {
            text += effect.delta
            persistEmit('response.output_text.delta', { delta: effect.delta })
          } else if (effect.type === 'thinking') {
            const partKey = `${continuation}:${effect.index}`
            if (reasoning && previousReasoningPart && previousReasoningPart !== partKey) {
              reasoning = joinReasoningSummaryParts([reasoning, effect.delta])
            } else {
              reasoning += effect.delta
            }
            previousReasoningPart = partKey
            persistEmit('response.reasoning_summary_text.delta', {
              delta: effect.delta,
              item_id: `anthropic-thinking-${partKey}`,
              summary_index: 0,
            })
          } else if (effect.type === 'citation') {
            const citation = anthropicCitation(
              effect.citation,
              textOffset + effect.start,
              textOffset + effect.end,
            )
            if (citation) {
              annotations.push(citation)
              persistEmit('response.output_text.annotation.added', { annotation: citation })
            }
          } else if (effect.type === 'web_search_start') {
            const outputIndex = searchOutputIndexById.size
            searchOutputIndexById.set(effect.id, outputIndex)
            persistEmit('response.output_item.added', {
              output_index: outputIndex,
              item: { type: 'web_search_call', id: effect.id, status: 'in_progress' },
            })
            persistEmit('response.web_search_call.in_progress', { item_id: effect.id })
            persistEmit('response.web_search_call.searching', { item_id: effect.id })
          } else if (effect.type === 'web_search_input') {
            const query = typeof effect.input.query === 'string' ? effect.input.query : undefined
            const action: SearchAction = {
              type: 'search',
              ...(query ? { queries: [query] } : {}),
            }
            searchActionById.set(effect.id, action)
            searchActions = [...searchActionById.values()]
            persistEmit('response.output_item.added', {
              output_index: searchOutputIndexById.get(effect.id) ?? 0,
              item: {
                type: 'web_search_call',
                id: effect.id,
                status: 'in_progress',
                action,
              },
            })
          } else if (effect.type === 'web_search_result') {
            const currentAction = searchActionById.get(effect.toolUseId) ?? { type: 'search' }
            const action: SearchAction = effect.errorCode
              ? { ...currentAction, error: effect.errorCode }
              : currentAction
            searchActionById.set(effect.toolUseId, action)
            searchActions = [...searchActionById.values()]
            persistEmit('response.output_item.done', {
              output_index: searchOutputIndexById.get(effect.toolUseId) ?? 0,
              item: {
                type: 'web_search_call',
                id: effect.toolUseId,
                status: 'completed',
                action,
              },
            })
            persistEmit('response.web_search_call.completed', {
              item_id: effect.toolUseId,
              ...(effect.errorCode ? { error: effect.errorCode } : {}),
            })
          }
        }
      }

      const segmentContent = accumulator.finish()
      rawContent.push(...segmentContent)
      usage = addMessageUsage(usage, mapAnthropicUsage(accumulator.usage))
      upstreamResponseId = accumulator.messageId ?? upstreamResponseId
      finalStopReason = accumulator.stopReason

      if (accumulator.stopReason !== 'pause_turn') break
      if (continuation >= MAX_PAUSE_TURN_CONTINUATIONS - 1) {
        throw new UpstreamError({
          message: 'Anthropic 服务端工具连续暂停次数过多，已停止继续请求。',
          status: 500,
          type: 'pause_turn_limit',
        })
      }
      messages = [...messages, { role: 'assistant', content: segmentContent }]
      requestBody = { ...ctx.body, messages }
    }

    const terminal = classifyAnthropicTerminal(finalStopReason)
    state = terminal.state
    incompleteReason = terminal.incompleteReason
    errorType = terminal.errorType
    discardPartialOutput = terminal.discardPartialOutput

    if (terminal.errorType === 'refusal') {
      // 官方要求 refusal 丢弃拒绝前的部分输出；usage 仍保留上游实际计量。
      text = ''
      reasoning = ''
      annotations.length = 0
      searchActions = []
      rawContent.length = 0
      errorMessage = '模型拒绝了此请求，请调整内容后重试。'
    } else if (terminal.errorType === 'tool_use') {
      errorMessage = '模型请求了本站不支持的客户端工具，生成已停止。'
    } else if (terminal.errorType === 'invalid_response') {
      errorMessage = 'Anthropic 流未返回 stop_reason'
    } else if (terminal.state === 'failed') {
      errorMessage = `Anthropic 返回了不支持的结束原因：${finalStopReason}`
    }
  } catch (error) {
    if (ctx.abortController.signal.aborted) {
      state = 'canceled'
    } else {
      const upstreamError = error instanceof UpstreamError ? error : null
      state = 'failed'
      errorMessage = redactProviderOpaqueContent(
        upstreamError?.message ?? (error instanceof Error ? error.message : '生成失败'),
        [...sensitiveProviderContent],
      )
      errorType = upstreamError?.type
        ? redactProviderOpaqueContent(upstreamError.type, [...sensitiveProviderContent])
        : error instanceof Error
          ? error.name
          : null
      errorCode = upstreamError?.code
        ? redactProviderOpaqueContent(upstreamError.code, [...sensitiveProviderContent])
        : null
      httpStatus = upstreamError?.status ?? null
    }
  }

  const truncatedWithUnresolvedToolUse = state === 'incomplete' && hasUnresolvedToolUse(rawContent)

  await finalizeRun({
    run: ctx.run,
    assistantMessage: ctx.assistantMessage,
    conversation: ctx.conversation,
    model: ctx.model,
    provider: ctx.provider,
    state,
    text,
    ...(discardPartialOutput ? { content: [] } : {}),
    reasoningSummary: reasoning || null,
    annotations,
    usage,
    searchActions,
    incompleteReason,
    errorMessage,
    errorType,
    errorCode,
    httpStatus,
    upstreamResponseId,
    providerReplayContext: truncatedWithUnresolvedToolUse ? null : replayContext(ctx, rawContent),
    discardPartialOutput,
    startedAt,
    upstreamResponseLatencyMs: upstreamResponseTiming.latencyMs,
    persistEmit,
  })
}
