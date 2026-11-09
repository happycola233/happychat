import type { ContentPart, ImageGenerationUsage, MessageUsage } from '@shared/types/domain'
import { providerClientFromRow, type ProviderClient } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import { collectProviderOpaqueStrings } from '../provider/opaque-content'
import { parseImageGenerationUsage } from '../provider/image-usage'
import { executeRun, type RunAttemptRuntime } from './execute-run'
import type { AttemptResult } from './finalize'
import {
  describeImageGeneration,
  discardPartialImages,
  storeGeneratedImageAttachment,
} from './generated-images'
import type { EngineContext, RunExecution } from './types'

interface ImageApiUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  output_tokens_details?: { image_tokens?: number }
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
}

/** SVG 由「参考图 + 作者模型」两段生成，作者模型的用量单独在 svg_usage 中返回。 */
interface SvgUsage {
  input_tokens?: number
  output_tokens?: number
  reasoning_tokens?: number
  total_tokens?: number
}

interface ImageResponse {
  data?: { b64_json?: string; revised_prompt?: string }[]
  output_format?: string
  size?: string
  quality?: string
  background?: string
  usage?: ImageApiUsage
  svg_usage?: SvgUsage
}

/** 一次上游调用产出的最终图片及其用量；流式时每个 completed 事件一组。 */
interface ImageBatch {
  images: { b64Json: string; revisedPrompt?: string }[]
  outputFormat: string | null
  size?: string
  quality?: string
  background?: string
  usage?: ImageApiUsage
  svgUsage?: SvgUsage
}

const SLOT = { generationId: 'image-0', callId: null, index: 0, outputIndex: null }

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/** 图片和文本共用尝试、取消及审计流程；流式时先展示过程预览，完整结果到达后才落最终图。 */
export async function runImageEngine(execution: RunExecution): Promise<void> {
  await executeRun(execution, runImageAttempt)
}

async function requestImageBatches(
  client: ProviderClient,
  ctx: EngineContext,
): Promise<ImageBatch[]> {
  const signal = ctx.abortController.signal
  const response = (await (ctx.imageOperation === 'edit'
    ? client.editImage(ctx.body, signal)
    : client.createImage(ctx.body, signal))) as ImageResponse
  return [
    {
      images: (response.data ?? []).flatMap((item) =>
        item.b64_json ? [{ b64Json: item.b64_json, revisedPrompt: item.revised_prompt }] : [],
      ),
      outputFormat: str(response.output_format) ?? null,
      size: response.size,
      quality: response.quality,
      background: response.background,
      usage: response.usage,
      svgUsage: response.svg_usage,
    },
  ]
}

/**
 * 流式事件：生成为 image_generation.*，编辑为 image_edit.*，字段一致。
 * partial_image 只作为临时预览附件（不计张数、不进最终内容），completed 才是最终图。
 */
async function streamImageBatches(
  client: ProviderClient,
  ctx: EngineContext,
  onPartial: (b64Json: string, partialIndex: number | null, outputFormat: string | null) => void,
): Promise<ImageBatch[]> {
  const signal = ctx.abortController.signal
  const stream =
    ctx.imageOperation === 'edit'
      ? client.editImageStream(ctx.body, signal)
      : client.createImageStream(ctx.body, signal)
  const batches: ImageBatch[] = []
  for await (const event of stream) {
    const data = event.data
    const error = data.error as { type?: string; code?: string; message?: string } | undefined
    if (event.type === 'error' || error) {
      throw new UpstreamError({
        status: 200,
        type: error?.type,
        code: error?.code ?? str(data.code),
        rawMessage: error?.message ?? str(data.message),
      })
    }
    const b64Json = str(data.b64_json)
    if (!b64Json) continue
    const outputFormat = str(data.output_format) ?? null
    if (event.type.endsWith('.partial_image')) {
      onPartial(
        b64Json,
        typeof data.partial_image_index === 'number' ? data.partial_image_index : null,
        outputFormat,
      )
    } else if (event.type.endsWith('.completed')) {
      batches.push({
        images: [{ b64Json }],
        outputFormat,
        size: str(data.size),
        quality: str(data.quality),
        background: str(data.background),
        usage: data.usage as ImageApiUsage | undefined,
      })
    }
  }
  if (!batches.length)
    throw new UpstreamError({
      message: '图片生成流意外中断',
      status: 200,
      type: 'incomplete_stream',
    })
  return batches
}

async function runImageAttempt(
  ctx: EngineContext,
  runtime: RunAttemptRuntime,
): Promise<AttemptResult> {
  const { persistEmit, startedAt, upstreamResponseTiming, recordError } = runtime
  persistEmit('image.generation.in_progress', SLOT)
  // 与前端舞台计时同一起点：本次尝试开始生成的时刻。
  const generationStartedAt = Date.now()
  let state: 'completed' | 'failed' | 'canceled' = 'completed'
  let errorMessage: string | null = null
  let errorType: string | null = null
  let errorCode: string | null = null
  let httpStatus: number | null = null
  let imageTokens = 0
  const imageUsage: ImageGenerationUsage[] = []
  const content: ContentPart[] = []
  const partialAttachmentIds = new Set<string>()
  const usage: MessageUsage = {
    inputTokens: 0,
    cacheWriteTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }

  const savePartial = (
    b64Json: string,
    partialIndex: number | null,
    outputFormat: string | null,
  ) => {
    try {
      const stored = storeGeneratedImageAttachment({
        userId: ctx.run.userId,
        messageId: ctx.assistantMessage.id,
        b64Json,
        filenamePrefix:
          partialIndex === null ? 'partial-image-1' : `partial-image-1-${partialIndex}`,
        outputFormat,
      })
      partialAttachmentIds.add(stored.attachmentId)
      persistEmit('image.generation.partial', {
        ...SLOT,
        attachmentId: stored.attachmentId,
        partialIndex,
      })
    } catch (error) {
      console.warn('保存生图过程预览失败:', error)
    }
  }

  try {
    const client = providerClientFromRow(ctx.provider, upstreamResponseTiming)
    // 以最终请求体为准：过程预览张数可能被高级 JSON 覆盖，stream 与之同源。
    const batches =
      ctx.body.stream === true
        ? await streamImageBatches(client, ctx, savePartial)
        : await requestImageBatches(client, ctx)
    for (const batch of batches) {
      usage.inputTokens += batch.usage?.input_tokens ?? 0
      usage.outputTokens += batch.usage?.output_tokens ?? 0
      usage.totalTokens += batch.usage?.total_tokens ?? 0
      imageTokens +=
        batch.usage?.output_tokens_details?.image_tokens ?? batch.usage?.output_tokens ?? 0
      // SVG 作者模型的 Token 计入消息用量明细；生图计价仍只按参考图的图片用量与张数。
      if (batch.svgUsage) {
        usage.inputTokens += batch.svgUsage.input_tokens ?? 0
        usage.outputTokens += batch.svgUsage.output_tokens ?? 0
        usage.reasoningTokens += batch.svgUsage.reasoning_tokens ?? 0
        usage.totalTokens += batch.svgUsage.total_tokens ?? 0
      }
      // 张数只数最终文件：一个 GIF 或一个 SVG 都是 1 张，过程预览不计入。
      imageUsage.push(
        parseImageGenerationUsage(
          batch.usage,
          batch.images.length,
          { size: batch.size, quality: batch.quality },
          ctx.body,
        ),
      )
    }
    const images = batches.flatMap((batch) =>
      batch.images.map((image) => ({
        ...image,
        outputFormat: batch.outputFormat,
        generation: describeImageGeneration({
          request: ctx.body,
          result: {
            size: batch.size,
            quality: batch.quality,
            background: batch.background,
            output_format: batch.outputFormat,
          },
          operation: ctx.imageOperation ?? 'generate',
          inputImageCount: Array.isArray(ctx.body.images) ? ctx.body.images.length : 0,
          startedAt: generationStartedAt,
        }),
      })),
    )
    if (!images.length)
      throw new UpstreamError({
        message: '上游未返回图片数据',
        status: 200,
        type: 'invalid_response',
      })
    for (const [index, image] of images.entries()) {
      const stored = storeGeneratedImageAttachment({
        userId: ctx.run.userId,
        messageId: ctx.assistantMessage.id,
        b64Json: image.b64Json,
        filenamePrefix: `generated-${index + 1}`,
        outputFormat: image.outputFormat,
      })
      content.push({
        type: 'image_result',
        attachment_id: stored.attachmentId,
        revised_prompt: image.revisedPrompt,
        mime: stored.mime,
        generation: image.generation,
      })
      persistEmit('image.generation.completed', {
        generationId: `image-${index}`,
        callId: null,
        index,
        outputIndex: null,
        attachmentId: stored.attachmentId,
        revisedPrompt: image.revisedPrompt ?? null,
        mime: stored.mime,
      })
    }
    discardPartialImages(ctx.run.id, partialAttachmentIds)
  } catch (error) {
    if (ctx.abortController.signal.aborted) state = 'canceled'
    else {
      const upstream = error instanceof UpstreamError ? error : null
      recordError(upstream)
      state = 'failed'
      errorMessage =
        upstream?.toUserMessage(collectProviderOpaqueStrings(ctx.body)) ??
        (error instanceof Error ? error.message : '生成失败')
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
    state,
    text: '',
    content,
    processSteps: [],
    annotations: [],
    usage,
    imageTokens,
    imageUsage,
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
