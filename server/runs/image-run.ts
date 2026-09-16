import type { ContentPart, MessageUsage } from '@shared/types/domain'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import { executeRun, type RunAttemptRuntime } from './execute-run'
import type { FinalizeArgs } from './finalize'
import { storeGeneratedImageAttachment } from './generated-images'
import type { EngineContext } from './types'

interface ImageResponse {
  data?: { b64_json?: string; revised_prompt?: string }[]
  output_format?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    output_tokens_details?: { image_tokens?: number }
  }
}

/** 图片和文本共用尝试、取消及审计流程，完整结果到达后才落图。 */
export async function runImageEngine(ctx: EngineContext): Promise<void> {
  await executeRun(ctx, runImageAttempt)
}

async function runImageAttempt(
  ctx: EngineContext,
  runtime: RunAttemptRuntime,
): Promise<FinalizeArgs> {
  const { persistEmit, startedAt, upstreamResponseTiming, recordError } = runtime
  const imageSlot = { generationId: 'image-0', callId: null, index: 0, outputIndex: null }
  persistEmit('image.generation.in_progress', imageSlot)
  let state: 'completed' | 'failed' | 'canceled' = 'completed'
  let errorMessage: string | null = null
  let errorType: string | null = null
  let errorCode: string | null = null
  let httpStatus: number | null = null
  let imageTokens = 0
  const content: ContentPart[] = []
  const usage: MessageUsage = {
    inputTokens: 0,
    cacheWriteTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
  try {
    const client = providerClientFromRow(ctx.provider, upstreamResponseTiming)
    const response = (await (ctx.imageOperation === 'edit'
      ? client.editImage(ctx.body, ctx.abortController.signal)
      : client.createImage(ctx.body, ctx.abortController.signal))) as ImageResponse
    usage.inputTokens = response.usage?.input_tokens ?? 0
    usage.outputTokens = response.usage?.output_tokens ?? 0
    usage.totalTokens = response.usage?.total_tokens ?? 0
    imageTokens = response.usage?.output_tokens_details?.image_tokens ?? usage.outputTokens
    const item = response.data?.[0]
    if (!item?.b64_json)
      throw new UpstreamError({
        message: '上游未返回图片数据',
        status: 200,
        type: 'invalid_response',
      })
    const stored = storeGeneratedImageAttachment({
      userId: ctx.run.userId,
      messageId: ctx.assistantMessage.id,
      b64Json: item.b64_json,
      outputFormat: typeof response.output_format === 'string' ? response.output_format : null,
    })
    content.push({
      type: 'image_result',
      attachment_id: stored.attachmentId,
      revised_prompt: item.revised_prompt,
    })
    persistEmit('image.generation.completed', {
      ...imageSlot,
      attachmentId: stored.attachmentId,
      revisedPrompt: item.revised_prompt ?? null,
    })
  } catch (error) {
    if (ctx.abortController.signal.aborted) state = 'canceled'
    else {
      const upstream = error instanceof UpstreamError ? error : null
      recordError(upstream)
      state = 'failed'
      errorMessage = upstream?.message ?? (error instanceof Error ? error.message : '生成失败')
      errorType = upstream?.type ?? null
      errorCode = upstream?.code ?? null
      httpStatus = upstream?.status ?? null
    }
  }
  return {
    run: ctx.run,
    assistantMessage: ctx.assistantMessage,
    conversation: ctx.conversation,
    model: ctx.model,
    provider: ctx.provider,
    state,
    text: '',
    content,
    processSteps: [],
    annotations: [],
    usage,
    imageTokens,
    incompleteReason: null,
    errorMessage,
    errorType,
    errorCode,
    httpStatus,
    upstreamResponseId: null,
    startedAt,
    upstreamResponseLatencyMs: upstreamResponseTiming.latencyMs,
    persistEmit,
  }
}
