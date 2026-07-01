import { eq, inArray } from 'drizzle-orm'
import type { ContentPart, ModelParams } from '@shared/types/domain'
import { shouldValidateGptImage2Size, validateGptImage2Size } from '@shared/util/imageSize'
import { renderPromptTemplate } from '@shared/util/promptTemplate'
import { db } from '../db/client'
import { attachments, conversations, messages, runs, users } from '../db/schema'
import { buildPromptVars } from './promptVars'
import { must } from '../lib/assert'
import { buildChatBody, buildChatMessages } from '../provider/chat'
import { buildInput, type ResolvedAttachment } from '../provider/context'
import { buildImageBody, buildImageEditBody, buildResponseBody } from '../provider/params'
import { promptCacheKeyForConversation } from '../provider/promptCache'
import { buildPath, getConversationMessages, getOwnedConversation } from '../services/conversations'
import { getRunnableModel } from '../services/models'
import {
  MAX_FILE_INPUT_BYTES,
  MAX_FILE_INPUT_REQUEST_BYTES,
  fileInputMime,
  toDataUrl,
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

/** 读取路径中引用的附件为内联 data URL（请求构建用）。 */
async function resolveAttachments(
  pathMessages: MsgRow[],
): Promise<Map<string, ResolvedAttachment>> {
  const ids = new Set<string>()
  for (const m of pathMessages) {
    for (const p of m.content) {
      if ((p.type === 'input_image' || p.type === 'input_file') && p.attachment_id) {
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
 * Responses API 会重放当前分支上的全部 input_file，因此预算必须覆盖历史文件和本轮文件，
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
  const requestParams: Record<string, unknown> = { ...(userParams ?? {}) }
  if (clientLocale) requestParams.clientLocale = clientLocale

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

  const all = await getConversationMessages(conv.id)
  const path = buildPath(all, parentMessageId)

  let body: Record<string, unknown>
  let imageOperation: ImageOperation | undefined
  if (model.kind === 'image') {
    const userMsg = path[path.length - 1]
    const prompt = (userMsg?.content ?? [])
      .map((p) => (p.type === 'input_text' ? p.text : ''))
      .join('\n')
      .trim()
    const imageUrls = await resolveImageUrls(userMsg?.content ?? [])
    if (imageUrls.length > 0) {
      body = buildImageEditBody(model, prompt, imageUrls, userParams)
      imageOperation = 'edit'
    } else {
      body = buildImageBody(model, prompt, userParams)
      imageOperation = 'generate'
    }
  } else {
    const attMap = await resolveAttachments(path)
    const pathMessages = path.map((m) => ({
      role: m.role,
      content: m.content,
      runtimeContext: m.runtimeContext,
    }))
    const input = buildInput(pathMessages, attMap)
    // 始终读取模型当前提示词：管理员更新后，旧会话的下一次请求立即生效。
    // runs.instructions 仅保存本次最终值，不参与后续请求选择。
    let instructions = model.defaultSystemPrompt
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
    // 持久化最终 instructions（启用 runs.instructions 列，便于审计）
    await db.update(runs).set({ instructions }).where(eq(runs.id, run.id))
    // 文本会话始终使用稳定路由 key；模型开关只决定是否应用 Provider 的保留策略。
    const promptCacheKey = promptCacheKeyForConversation(conv.id)
    const promptCacheRetention = model.promptCacheRetentionEnabled
      ? provider.promptCacheRetention
      : undefined
    if (model.kind === 'chat') {
      const chatMessages = buildChatMessages(pathMessages, attMap, instructions)
      body = buildChatBody({
        model,
        messages: chatMessages,
        userParams,
        stream: true,
        promptCacheKey,
        promptCacheRetention,
      })
    } else {
      body = buildResponseBody({
        model,
        input,
        instructions,
        userParams,
        stream: true,
        promptCacheKey,
        promptCacheRetention,
      })
    }
  }

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
  const runnable = await getRunnableModel(args.modelId)
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
  const normalizedParams = normalizeImageParamsForModel(model, args.params)
  if (!normalizedParams.ok) return normalizedParams

  const refs = args.attachments ?? []
  const sourceRefs = args.imageSources ?? []
  const allImageRefIds = [
    ...refs.filter((r) => r.kind === 'image').map((r) => r.attachmentId),
    ...sourceRefs.map((r) => r.attachmentId),
  ]
  const idsToValidate = [...new Set([...refs.map((r) => r.attachmentId), ...allImageRefIds])]
  if (idsToValidate.length > 0) {
    const rows = await db.select().from(attachments).where(inArray(attachments.id, idsToValidate))
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
  if (model.kind === 'responses') {
    const allMessages = conv ? await getConversationMessages(conv.id) : []
    const parentPath = parentId ? buildPath(allMessages, parentId) : []
    const fileBudgetError = await validateFileInputBudget(parentPath, refs)
    if (fileBudgetError) return fileBudgetError
  }

  if (!conv) {
    conv = must(
      await db
        .insert(conversations)
        .values({
          userId: args.userId,
          modelId: model.id,
          // 标题留空，待首条助手回复完成后异步总结（见 services/title.ts）
          title: null,
        })
        .returning()
        .then((r) => r[0]),
    )
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
      userContent.push({ type: 'input_file', attachment_id: r.attachmentId, filename: r.filename })
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

  const userMessage = must(
    await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        parentId,
        role: 'user',
        status: 'complete',
        content: userContent,
        runtimeContext: buildRuntimeContext(new Date(), args.clientTimezone),
      })
      .returning()
      .then((r) => r[0]),
  )

  if (refs.length > 0) {
    await db
      .update(attachments)
      .set({ messageId: userMessage.id })
      .where(
        inArray(
          attachments.id,
          refs.map((r) => r.attachmentId),
        ),
      )
  }

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
  const runnable = await getRunnableModel(modelDbId)
  if (!runnable)
    return { ok: false, status: 400, message: '所选模型不可用', code: 'model_unavailable' }
  const { model, provider } = runnable
  const normalizedParams = normalizeImageParamsForModel(model, args.params)
  if (!normalizedParams.ok) return normalizedParams

  if (model.kind === 'responses') {
    const allMessages = await getConversationMessages(conv.id)
    const parentPath = buildPath(allMessages, oldAssistant.parentId)
    const fileBudgetError = await validateFileInputBudget(parentPath, [])
    if (fileBudgetError) return fileBudgetError
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
