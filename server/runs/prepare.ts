import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ContentPart, ModelParams } from '@shared/types/domain'
import { shouldValidateGptImage2Size, validateGptImage2Size } from '@shared/util/imageSize'
import { renderPromptTemplate } from '@shared/util/promptTemplate'
import { isReasoningEffortAllowed } from '@shared/util/reasoning'
import { normalizeSearchParamsForModelKind } from '@shared/util/searchTools'
import { db } from '../db/client'
import { attachments, conversations, messages, runs, users } from '../db/schema'
import { buildPromptVars } from './promptVars'
import { must } from '../lib/assert'
import { buildChatBody, buildChatMessages } from '../provider/chat'
import { buildAnthropicBody, buildAnthropicMessages } from '../provider/anthropic'
import {
  buildInput,
  MAX_GENERATED_IMAGE_CONTEXT_ITEMS,
  type ResolvedAttachment,
} from '../provider/context'
import { buildImageBody, buildImageEditBody, buildResponseBody } from '../provider/params'
import { promptCacheKeyForConversation } from '../provider/promptCache'
import type { AnthropicReplayContextV1, ProviderReplayContext } from '../provider/reasoning-replay'
import { buildPath, getConversationMessages, getOwnedConversation } from '../services/conversations'
import { getRunnableModel } from '../services/models'
import {
  MAX_FILE_INPUT_BYTES,
  MAX_FILE_INPUT_REQUEST_BYTES,
  fileInputMime,
  toDataUrl,
  uploadFileExists,
} from '../storage/files'
import type { ConvRow, ImageOperation, ModelRow, MsgRow, ProviderRow, RunRow } from './types'
import { appendRuntimeContextInstructions, buildRuntimeContext } from './runtimeContext'

export interface AttachmentRef {
  attachmentId: string
  kind: 'image' | 'file'
  filename: string
  detail?: 'auto' | 'low' | 'high'
}

export interface ImageSourceRef {
  attachmentId: string
  detail?: 'auto' | 'low' | 'high'
}

const IMAGE_EDIT_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const ANTHROPIC_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const ANTHROPIC_MAX_BASE64_IMAGE_BYTES = 10 * 1024 * 1024

export interface PreparedRun {
  ok: true
  conversation: ConvRow
  userMessage: MsgRow | null
  assistantMessage: MsgRow
  run: RunRow
  model: ModelRow
  provider: ProviderRow
  body: Record<string, unknown>
  imageOperation?: ImageOperation
}
export type PrepareError = { ok: false; status: 400 | 404; message: string; code: string }
export type PrepareResult = PreparedRun | PrepareError

function normalizeImageParamsForModel(
  model: ModelRow,
  params?: ModelParams,
): { ok: true; params?: ModelParams } | PrepareError {
  const size = params?.image?.size
  if (model.kind !== 'image' || !size || !shouldValidateGptImage2Size(model.modelId)) {
    return { ok: true, params }
  }

  const validation = validateGptImage2Size(size)
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      message: validation.message,
      code: 'invalid_image_size',
    }
  }

  if (validation.normalizedSize === size) return { ok: true, params }
  return {
    ok: true,
    params: {
      ...params,
      image: {
        ...params.image,
        size: validation.normalizedSize,
      },
    },
  }
}

function normalizeReasoningParamsForModel(
  model: ModelRow,
  params?: ModelParams,
): ModelParams | undefined {
  if (!params?.reasoning_effort || isReasoningEffortAllowed(model, params.reasoning_effort)) {
    return params
  }
  // 固定思考等级是跨模型偏好；落到某次请求前必须按当前模型能力裁剪。
  const { reasoning_effort: _unsupportedEffort, ...rest } = params
  return rest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 读取服务端私有信封时执行严格来源门控。历史未知版本、损坏数据或来源变化都只会
 * 静默跳过，不能让一条无法重放的 opaque 密文打断正常对话。
 */
export function selectReasoningReplayItems(args: {
  enabled: boolean
  context: ProviderReplayContext | Record<string, unknown> | null
  providerId: string
  providerBaseUrl: string
  upstreamModelId: string
}): unknown[] | undefined {
  if (!args.enabled || !isRecord(args.context) || args.context.version !== 1) return undefined
  if (!isRecord(args.context.source) || !Array.isArray(args.context.items)) return undefined

  const source = args.context.source
  if (
    source.providerId !== args.providerId ||
    source.providerBaseUrl !== args.providerBaseUrl ||
    source.upstreamModelId !== args.upstreamModelId
  ) {
    return undefined
  }
  return args.context.items
}

/** Anthropic 原始 content[] 只允许回到完全相同的提供商、Base URL 与模型。 */
export function selectAnthropicReplayContent(args: {
  enabled: boolean
  context: ProviderReplayContext | Record<string, unknown> | null
  providerId: string
  providerBaseUrl: string
  upstreamModelId: string
}): AnthropicReplayContextV1['content'] | undefined {
  if (!args.enabled || !isRecord(args.context) || args.context.version !== 1) return undefined
  if (args.context.protocol !== 'anthropic_messages' || !Array.isArray(args.context.content)) {
    return undefined
  }
  if (!isRecord(args.context.source)) return undefined
  const source = args.context.source
  if (
    source.providerId !== args.providerId ||
    source.providerBaseUrl !== args.providerBaseUrl ||
    source.upstreamModelId !== args.upstreamModelId
  ) {
    return undefined
  }
  return args.context.content.filter(isRecord)
}

/** 读取路径中引用的附件为内联 data URL（请求构建用）。 */
async function resolveAttachments(
  pathMessages: MsgRow[],
): Promise<Map<string, ResolvedAttachment>> {
  const ids = new Set<string>()
  for (const m of pathMessages) {
    for (const p of m.content) {
      if (
        (p.type === 'input_image' || p.type === 'input_file' || p.type === 'image_result') &&
        p.attachment_id
      ) {
        ids.add(p.attachment_id)
      }
    }
  }
  const map = new Map<string, ResolvedAttachment>()
  if (ids.size === 0) return map
  const rows = await db
    .select()
    .from(attachments)
    .where(inArray(attachments.id, [...ids]))
  for (const a of rows) {
    try {
      const mime = a.kind === 'file' ? fileInputMime(a.filename, a.mime) : a.mime
      if (!mime) continue
      map.set(a.id, {
        dataUrl: toDataUrl(a.storagePath, mime),
        mime,
        filename: a.filename,
        kind: a.kind,
      })
    } catch {
      // 文件缺失则跳过
    }
  }
  return map
}

/**
 * OpenAI Responses / Chat Completions 会重放当前分支上的全部 input_file，
 * 因此预算必须覆盖历史文件和本轮文件，
 * 不能只在上传接口检查单个附件。
 */
async function validateFileInputBudget(
  pathMessages: MsgRow[],
  newAttachments: AttachmentRef[],
): Promise<PrepareError | null> {
  const fileIds = pathMessages.flatMap((message) =>
    message.content
      .filter(
        (part): part is Extract<ContentPart, { type: 'input_file' }> => part.type === 'input_file',
      )
      .map((part) => part.attachment_id),
  )
  fileIds.push(
    ...newAttachments.filter((attachment) => attachment.kind === 'file').map((a) => a.attachmentId),
  )
  if (fileIds.length === 0) return null

  const rows = await db
    .select({
      id: attachments.id,
      byteSize: attachments.byteSize,
      mime: attachments.mime,
      filename: attachments.filename,
    })
    .from(attachments)
    .where(inArray(attachments.id, [...new Set(fileIds)]))
  const attachmentsById = new Map(rows.map((attachment) => [attachment.id, attachment]))
  let totalBytes = 0

  for (const fileId of fileIds) {
    const attachment = attachmentsById.get(fileId)
    // 缺失附件会在构建上下文时跳过；这里不把不存在的字节计入预算。
    if (!attachment) continue
    if (!fileInputMime(attachment.filename, attachment.mime)) {
      return {
        ok: false,
        status: 400,
        message: `不支持的文件类型：${attachment.filename}`,
        code: 'unsupported_file_type',
      }
    }
    if (attachment.byteSize >= MAX_FILE_INPUT_BYTES) {
      return {
        ok: false,
        status: 400,
        message: '单个文件必须小于 50MB',
        code: 'file_too_large',
      }
    }
    totalBytes += attachment.byteSize
  }

  if (totalBytes > MAX_FILE_INPUT_REQUEST_BYTES) {
    return {
      ok: false,
      status: 400,
      message: '单次请求中的文件总大小不能超过 50MB',
      code: 'file_request_too_large',
    }
  }
  return null
}

/** 在入队前校验 Anthropic 支持的附件类型与单图编码上限。完整 JSON 大小在 fetch 前精确校验。 */
async function validateAnthropicAttachments(
  pathMessages: MsgRow[],
  newAttachments: AttachmentRef[],
  imageSources: ImageSourceRef[],
): Promise<PrepareError | null> {
  const generatedImageIdSet = new Set(
    pathMessages
      .flatMap((message) =>
        message.content
          .filter(
            (part): part is Extract<ContentPart, { type: 'image_result' }> =>
              part.type === 'image_result',
          )
          .map((part) => part.attachment_id),
      )
      .slice(-MAX_GENERATED_IMAGE_CONTEXT_ITEMS),
  )
  const historicalRefs = pathMessages.flatMap((message) =>
    message.content
      .filter(
        (
          part,
        ): part is Extract<ContentPart, { type: 'input_image' | 'input_file' | 'image_result' }> =>
          part.type === 'input_image' ||
          part.type === 'input_file' ||
          (part.type === 'image_result' && generatedImageIdSet.has(part.attachment_id)),
      )
      .map((part) => ({
        id: part.attachment_id,
        kind: part.type === 'input_file' ? ('file' as const) : ('image' as const),
      })),
  )
  const newAttachmentIds = new Set(newAttachments.map((attachment) => attachment.attachmentId))
  const refs = [
    ...historicalRefs,
    ...newAttachments.map((attachment) => ({ id: attachment.attachmentId, kind: attachment.kind })),
    ...imageSources
      .filter((source) => !newAttachmentIds.has(source.attachmentId))
      .map((source) => ({ id: source.attachmentId, kind: 'image' as const })),
  ]
  if (refs.length === 0) return null

  const rows = await db
    .select({
      id: attachments.id,
      byteSize: attachments.byteSize,
      mime: attachments.mime,
      filename: attachments.filename,
    })
    .from(attachments)
    .where(inArray(attachments.id, [...new Set(refs.map((ref) => ref.id))]))
  const attachmentById = new Map(rows.map((attachment) => [attachment.id, attachment]))
  for (const ref of refs) {
    const attachment = attachmentById.get(ref.id)
    if (!attachment) continue
    if (ref.kind === 'image') {
      if (!ANTHROPIC_IMAGE_MIMES.has(attachment.mime)) {
        return {
          ok: false,
          status: 400,
          message: `Anthropic 图片输入不支持：${attachment.filename}`,
          code: 'unsupported_image_input',
        }
      }
      const base64Bytes = Math.ceil(attachment.byteSize / 3) * 4
      if (base64Bytes > ANTHROPIC_MAX_BASE64_IMAGE_BYTES) {
        return {
          ok: false,
          status: 400,
          message: 'Anthropic 单张图片的 base64 编码大小不能超过 10MB',
          code: 'image_too_large',
        }
      }
      continue
    }

    const mime = fileInputMime(attachment.filename, attachment.mime)
    if (mime !== 'application/pdf' && !mime?.startsWith('text/')) {
      return {
        ok: false,
        status: 400,
        message: `Anthropic Messages 仅支持 PDF 与纯文本文件：${attachment.filename}`,
        code: 'unsupported_file_type',
      }
    }
  }
  return null
}

async function resolveImageUrls(parts: ContentPart[]): Promise<string[]> {
  const ids = parts
    .filter((p): p is Extract<ContentPart, { type: 'input_image' }> => p.type === 'input_image')
    .map((p) => p.attachment_id)
  if (ids.length === 0) return []

  const rows = await db.select().from(attachments).where(inArray(attachments.id, ids))
  const byId = new Map(rows.map((a) => [a.id, a]))
  return ids
    .map((id) => {
      const a = byId.get(id)
      return a ? toDataUrl(a.storagePath, a.mime) : null
    })
    .filter((url): url is string => Boolean(url))
}

async function createAssistantAndRun(opts: {
  conversation: ConvRow
  model: ModelRow
  provider: ProviderRow
  parentMessageId: string
  userParams?: ModelParams
  clientLocale?: string
  idempotencyKey?: string
}): Promise<{
  conversation: ConvRow
  assistantMessage: MsgRow
  run: RunRow
  body: Record<string, unknown>
  imageOperation?: ImageOperation
}> {
  const {
    conversation: conv,
    model,
    provider,
    parentMessageId,
    userParams,
    clientLocale,
    idempotencyKey,
  } = opts
  // Chat 路径不提供应用托管的 Web/X Search，避免把无效开关写入运行记录或恢复到 UI。
  const effectiveUserParams = normalizeSearchParamsForModelKind(model.kind, userParams) ?? undefined
  const requestParams: Record<string, unknown> = { ...(effectiveUserParams ?? {}) }
  if (clientLocale) requestParams.clientLocale = clientLocale

  const all = await getConversationMessages(conv.id)
  const path = buildPath(all, parentMessageId)

  let body: Record<string, unknown>
  let imageOperation: ImageOperation | undefined
  let instructions: string | null = null
  if (model.kind === 'image') {
    const userMsg = path[path.length - 1]
    const prompt = (userMsg?.content ?? [])
      .map((p) => (p.type === 'input_text' ? p.text : ''))
      .join('\n')
      .trim()
    const imageUrls = await resolveImageUrls(userMsg?.content ?? [])
    if (imageUrls.length > 0) {
      body = buildImageEditBody(model, prompt, imageUrls, effectiveUserParams)
      imageOperation = 'edit'
    } else {
      body = buildImageBody(model, prompt, effectiveUserParams)
      imageOperation = 'generate'
    }
  } else {
    const attMap = await resolveAttachments(path)
    const pathMessages = path.map((m) => {
      const reasoningItems =
        model.kind === 'responses' && m.role === 'assistant'
          ? selectReasoningReplayItems({
              enabled: model.replayProviderContext,
              context: m.providerReplayContext,
              providerId: provider.id,
              providerBaseUrl: provider.baseUrl,
              upstreamModelId: model.modelId,
            })
          : undefined
      const anthropicContent =
        model.kind === 'anthropic' && m.role === 'assistant'
          ? selectAnthropicReplayContent({
              enabled: model.replayProviderContext,
              context: m.providerReplayContext,
              providerId: provider.id,
              providerBaseUrl: provider.baseUrl,
              upstreamModelId: model.modelId,
            })
          : undefined
      return {
        role: m.role,
        content: m.content,
        runtimeContext: m.runtimeContext,
        ...(reasoningItems ? { reasoningItems } : {}),
        ...(anthropicContent ? { anthropicContent } : {}),
      }
    })
    const input = buildInput(pathMessages, attMap)
    // 始终读取模型当前提示词：管理员更新后，旧会话的下一次请求立即生效。
    // runs.instructions 仅保存本次最终值，不参与后续请求选择。
    instructions = model.defaultSystemPrompt
    // 系统提示词含 {{变量}} 时按当前用户/模型/时间渲染
    if (instructions && instructions.includes('{{')) {
      const [userRow] = await db
        .select({ username: users.username, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, conv.userId))
        .limit(1)
      instructions = renderPromptTemplate(
        instructions,
        buildPromptVars({ user: userRow ?? null, model, now: new Date(), clientLocale }),
      )
    }
    instructions = appendRuntimeContextInstructions(instructions)
    // 文本会话始终使用稳定路由 key；其他上游参数仅由通用 hardParams 显式提供。
    const promptCacheKey = promptCacheKeyForConversation(conv.id)
    if (model.kind === 'chat') {
      const chatMessages = buildChatMessages(pathMessages, attMap, instructions)
      body = buildChatBody({
        model,
        messages: chatMessages,
        userParams: effectiveUserParams,
        stream: true,
        promptCacheKey,
      })
    } else if (model.kind === 'anthropic') {
      body = buildAnthropicBody({
        model,
        messages: buildAnthropicMessages(pathMessages, attMap),
        instructions,
        userParams: effectiveUserParams,
        stream: true,
      })
    } else {
      body = buildResponseBody({
        model,
        input,
        instructions,
        userParams: effectiveUserParams,
        stream: true,
        promptCacheKey,
      })
    }
  }

  // 请求体构建可能因模型参数或附件内容无效而失败，必须在创建 worker 状态前完成。
  const assistantMessage = must(
    await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        parentId: parentMessageId,
        role: 'assistant',
        status: 'streaming',
        modelId: model.id,
        content: [],
      })
      .returning()
      .then((r) => r[0]),
  )

  const run = must(
    await db
      .insert(runs)
      .values({
        conversationId: conv.id,
        assistantMessageId: assistantMessage.id,
        userId: conv.userId,
        modelId: model.id,
        state: 'queued',
        requestParams,
        instructions,
        idempotencyKey,
      })
      .returning()
      .then((r) => r[0]),
  )

  const updatedConversation = must(
    await db
      .update(conversations)
      .set({ activeLeafId: assistantMessage.id, modelId: model.id, updatedAt: new Date() })
      .where(eq(conversations.id, conv.id))
      .returning()
      .then((r) => r[0]),
  )

  return { conversation: updatedConversation, assistantMessage, run, body, imageOperation }
}

export interface PrepareArgs {
  userId: string
  conversationId?: string
  modelId: string
  text: string
  params?: ModelParams
  clientLocale?: string
  clientTimezone?: string
  idempotencyKey?: string
  parentId?: string | null
  attachments?: AttachmentRef[]
  imageSources?: ImageSourceRef[]
}

export async function prepareRun(args: PrepareArgs): Promise<PrepareResult> {
  const runnable = await getRunnableModel(args.modelId, args.userId)
  if (!runnable)
    return { ok: false, status: 400, message: '所选模型不可用', code: 'model_unavailable' }
  const { model, provider } = runnable
  if (model.kind === 'image' && !args.text.trim()) {
    return {
      ok: false,
      status: 400,
      message: '请输入图片生成或编辑提示词',
      code: 'prompt_required',
    }
  }
  const reasoningParams = normalizeReasoningParamsForModel(model, args.params)
  const normalizedParams = normalizeImageParamsForModel(model, reasoningParams)
  if (!normalizedParams.ok) return normalizedParams

  const refs = args.attachments ?? []
  const sourceRefs = args.imageSources ?? []
  const validatedAttachmentById = new Map<string, typeof attachments.$inferSelect>()
  const allImageRefIds = [
    ...refs.filter((r) => r.kind === 'image').map((r) => r.attachmentId),
    ...sourceRefs.map((r) => r.attachmentId),
  ]
  const idsToValidate = [...new Set([...refs.map((r) => r.attachmentId), ...allImageRefIds])]
  if (idsToValidate.length > 0) {
    const rows = await db.select().from(attachments).where(inArray(attachments.id, idsToValidate))
    rows.forEach((attachment) => validatedAttachmentById.set(attachment.id, attachment))
    const owned = new Set(rows.filter((a) => a.userId === args.userId).map((a) => a.id))
    if (idsToValidate.some((id) => !owned.has(id))) {
      return { ok: false, status: 400, message: '附件无效或无权访问', code: 'invalid_attachment' }
    }
    const kindById = new Map(rows.map((a) => [a.id, a.kind]))
    if (refs.some((r) => kindById.get(r.attachmentId) !== r.kind)) {
      return { ok: false, status: 400, message: '附件类型不匹配', code: 'invalid_attachment' }
    }
    if (allImageRefIds.length > 0 && !model.capabilities.vision) {
      return { ok: false, status: 400, message: '该模型不支持图片输入', code: 'no_vision' }
    }
    if (model.kind === 'image') {
      const imageRefIds = new Set(allImageRefIds)
      const unsupportedImage = rows.find(
        (a) => imageRefIds.has(a.id) && !IMAGE_EDIT_MIMES.has(a.mime),
      )
      if (unsupportedImage) {
        return {
          ok: false,
          status: 400,
          message: '图片模型参考图仅支持 PNG、JPEG 或 WebP',
          code: 'unsupported_image_input',
        }
      }
    }
    if (sourceRefs.some((r) => kindById.get(r.attachmentId) !== 'image')) {
      return { ok: false, status: 400, message: '图片编辑源无效', code: 'invalid_image_source' }
    }
    if (refs.some((r) => r.kind === 'file') && !model.capabilities.file_input) {
      return { ok: false, status: 400, message: '该模型不支持文件输入', code: 'no_file' }
    }
  }

  let conv = args.conversationId
    ? await getOwnedConversation(args.userId, args.conversationId)
    : null
  if (args.conversationId && !conv) {
    return { ok: false, status: 404, message: '会话不存在', code: 'not_found' }
  }
  const parentId = args.parentId !== undefined ? args.parentId : (conv?.activeLeafId ?? null)
  if (model.kind === 'responses' || model.kind === 'chat' || model.kind === 'anthropic') {
    const allMessages = conv ? await getConversationMessages(conv.id) : []
    const parentPath = parentId ? buildPath(allMessages, parentId) : []
    const attachmentBudgetError =
      model.kind === 'anthropic'
        ? await validateAnthropicAttachments(parentPath, refs, sourceRefs)
        : await validateFileInputBudget(parentPath, refs)
    if (attachmentBudgetError) return attachmentBudgetError
  }

  const userContent: ContentPart[] = []
  if (args.text.trim()) userContent.push({ type: 'input_text', text: args.text })
  for (const r of refs) {
    if (r.kind === 'image') {
      userContent.push({
        type: 'input_image',
        attachment_id: r.attachmentId,
        detail: r.detail ?? 'auto',
      })
    } else {
      // 展示元数据只信任附件表；客户端 filename 仍只用于请求校验前的引用描述。
      const attachment = must(validatedAttachmentById.get(r.attachmentId), '已验证的文件附件不存在')
      userContent.push({
        type: 'input_file',
        attachment_id: r.attachmentId,
        filename: attachment.filename,
        mime: attachment.mime,
        byte_size: attachment.byteSize,
      })
    }
  }
  const existingImageIds = new Set(
    userContent
      .filter((p): p is Extract<ContentPart, { type: 'input_image' }> => p.type === 'input_image')
      .map((p) => p.attachment_id),
  )
  for (const r of sourceRefs) {
    if (existingImageIds.has(r.attachmentId)) continue
    userContent.push({
      type: 'input_image',
      attachment_id: r.attachmentId,
      detail: r.detail ?? 'auto',
    })
  }
  if (userContent.length === 0) userContent.push({ type: 'input_text', text: args.text })

  type PersistedUserTurn = { ok: true; conversation: ConvRow; userMessage: MsgRow } | PrepareError

  const persistedTurn = db.transaction(
    (tx): PersistedUserTurn => {
      // 初次能力校验后，24 小时清理任务可能已经回收了过期草稿附件。
      // 在同一个 IMMEDIATE 事务里做最终复核、写消息和绑定，彻底关闭 TOCTOU 窗口。
      if (idsToValidate.length > 0) {
        const currentAttachmentRows = tx
          .select({ id: attachments.id, storagePath: attachments.storagePath })
          .from(attachments)
          .where(and(eq(attachments.userId, args.userId), inArray(attachments.id, idsToValidate)))
          .all()
        if (
          currentAttachmentRows.length !== idsToValidate.length ||
          currentAttachmentRows.some((attachment) => !uploadFileExists(attachment.storagePath))
        ) {
          return {
            ok: false,
            status: 400,
            message: '附件已过期、无效或无权访问，请重新上传',
            code: 'invalid_attachment',
          }
        }
      }

      let transactionConversation = conv
      if (transactionConversation) {
        transactionConversation =
          tx
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, transactionConversation.id),
                eq(conversations.userId, args.userId),
              ),
            )
            .get() ?? null
        if (!transactionConversation) {
          return {
            ok: false,
            status: 404,
            message: '会话不存在',
            code: 'not_found',
          }
        }
      } else {
        transactionConversation = must(
          tx
            .insert(conversations)
            .values({
              userId: args.userId,
              modelId: model.id,
              // 标题留空，待首条助手回复完成后异步总结（见 services/title.ts）
              title: null,
            })
            .returning()
            .get(),
        )
      }

      const userMessage = must(
        tx
          .insert(messages)
          .values({
            conversationId: transactionConversation.id,
            parentId,
            role: 'user',
            status: 'complete',
            content: userContent,
            runtimeContext: buildRuntimeContext(new Date(), args.clientTimezone),
          })
          .returning()
          .get(),
      )

      const refIds = [...new Set(refs.map((ref) => ref.attachmentId))]
      if (refIds.length > 0) {
        // 编辑重发允许复用已绑定附件，沿用原行为把归属移动到新的用户消息。
        tx.update(attachments)
          .set({ messageId: userMessage.id })
          .where(and(eq(attachments.userId, args.userId), inArray(attachments.id, refIds)))
          .run()
      }

      const refIdSet = new Set(refIds)
      const unboundImageSourceIds = [
        ...new Set(
          sourceRefs
            .map((source) => source.attachmentId)
            .filter((attachmentId) => !refIdSet.has(attachmentId)),
        ),
      ]
      if (unboundImageSourceIds.length > 0) {
        // 已有生成图继续保留原消息归属；仅认领尚未绑定、但本轮消息确实引用的图片源。
        tx.update(attachments)
          .set({ messageId: userMessage.id })
          .where(
            and(
              eq(attachments.userId, args.userId),
              inArray(attachments.id, unboundImageSourceIds),
              isNull(attachments.messageId),
            ),
          )
          .run()
      }

      return { ok: true, conversation: transactionConversation, userMessage }
    },
    // 与孤立附件清理使用相同锁级别：谁先取得写锁，谁的结果先成为事实。
    { behavior: 'immediate' },
  )
  if (!persistedTurn.ok) return persistedTurn

  conv = persistedTurn.conversation
  const { userMessage } = persistedTurn

  const { conversation, assistantMessage, run, body, imageOperation } = await createAssistantAndRun(
    {
      conversation: conv,
      model,
      provider,
      parentMessageId: userMessage.id,
      userParams: normalizedParams.params,
      clientLocale: args.clientLocale,
      idempotencyKey: args.idempotencyKey,
    },
  )

  return {
    ok: true,
    conversation,
    userMessage,
    assistantMessage,
    run,
    model,
    provider,
    body,
    imageOperation,
  }
}

export interface RegenerateArgs {
  userId: string
  assistantMessageId: string
  modelId?: string
  params?: ModelParams
  clientLocale?: string
  idempotencyKey?: string
}

export async function prepareRegenerate(args: RegenerateArgs): Promise<PrepareResult> {
  const [oldAssistant] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, args.assistantMessageId))
    .limit(1)
  if (!oldAssistant || oldAssistant.role !== 'assistant' || !oldAssistant.parentId) {
    return { ok: false, status: 404, message: '消息不存在', code: 'not_found' }
  }
  const conv = await getOwnedConversation(args.userId, oldAssistant.conversationId)
  if (!conv) return { ok: false, status: 404, message: '会话不存在', code: 'not_found' }

  const modelDbId = args.modelId ?? oldAssistant.modelId
  if (!modelDbId) return { ok: false, status: 400, message: '缺少模型', code: 'model_unavailable' }
  const runnable = await getRunnableModel(modelDbId, args.userId)
  if (!runnable)
    return { ok: false, status: 400, message: '所选模型不可用', code: 'model_unavailable' }
  const { model, provider } = runnable
  const reasoningParams = normalizeReasoningParamsForModel(model, args.params)
  const normalizedParams = normalizeImageParamsForModel(model, reasoningParams)
  if (!normalizedParams.ok) return normalizedParams

  if (model.kind === 'responses' || model.kind === 'chat' || model.kind === 'anthropic') {
    const allMessages = await getConversationMessages(conv.id)
    const parentPath = buildPath(allMessages, oldAssistant.parentId)
    const attachmentBudgetError =
      model.kind === 'anthropic'
        ? await validateAnthropicAttachments(parentPath, [], [])
        : await validateFileInputBudget(parentPath, [])
    if (attachmentBudgetError) return attachmentBudgetError
  }

  const { conversation, assistantMessage, run, body, imageOperation } = await createAssistantAndRun(
    {
      conversation: conv,
      model,
      provider,
      parentMessageId: oldAssistant.parentId,
      userParams: normalizedParams.params,
      clientLocale: args.clientLocale,
      idempotencyKey: args.idempotencyKey,
    },
  )

  return {
    ok: true,
    conversation,
    userMessage: null,
    assistantMessage,
    run,
    model,
    provider,
    body,
    imageOperation,
  }
}
