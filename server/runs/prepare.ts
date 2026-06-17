import { eq, inArray } from 'drizzle-orm'
import type { ContentPart, ModelParams } from '@shared/types/domain'
import { shouldValidateGptImage2Size, validateGptImage2Size } from '@shared/util/imageSize'
import { db } from '../db/client'
import { attachments, conversations, messages, runs } from '../db/schema'
import { must } from '../lib/assert'
import { buildInput, type ResolvedAttachment } from '../provider/context'
import { buildImageBody, buildImageEditBody, buildResponseBody } from '../provider/params'
import { buildPath, getConversationMessages, getOwnedConversation } from '../services/conversations'
import { getRunnableModel } from '../services/models'
import { toDataUrl } from '../storage/files'
import type { ConvRow, ImageOperation, ModelRow, MsgRow, ProviderRow, RunRow } from './types'

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
      map.set(a.id, {
        dataUrl: toDataUrl(a.storagePath, a.mime),
        mime: a.mime,
        filename: a.filename,
        kind: a.kind,
      })
    } catch {
      // 文件缺失则跳过
    }
  }
  return map
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
  parentMessageId: string
  userParams?: ModelParams
  idempotencyKey?: string
}): Promise<{
  conversation: ConvRow
  assistantMessage: MsgRow
  run: RunRow
  body: Record<string, unknown>
  imageOperation?: ImageOperation
}> {
  const { conversation: conv, model, parentMessageId, userParams, idempotencyKey } = opts

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
        requestParams: (userParams ?? {}) as Record<string, unknown>,
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
    const input = buildInput(
      path.map((m) => ({ role: m.role, content: m.content })),
      attMap,
    )
    const instructions = updatedConversation.systemPromptOverride ?? model.defaultSystemPrompt
    body = buildResponseBody({ model, input, instructions, userParams, stream: true })
  }

  return { conversation: updatedConversation, assistantMessage, run, body, imageOperation }
}

export interface PrepareArgs {
  userId: string
  conversationId?: string
  modelId: string
  text: string
  params?: ModelParams
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
  if (!conv) {
    conv = must(
      await db
        .insert(conversations)
        .values({
          userId: args.userId,
          modelId: model.id,
          title: args.text.slice(0, 30) || '新对话',
        })
        .returning()
        .then((r) => r[0]),
    )
  }

  const parentId = args.parentId !== undefined ? args.parentId : conv.activeLeafId
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
      parentMessageId: userMessage.id,
      userParams: normalizedParams.params,
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

  const { conversation, assistantMessage, run, body, imageOperation } = await createAssistantAndRun(
    {
      conversation: conv,
      model,
      parentMessageId: oldAssistant.parentId,
      userParams: normalizedParams.params,
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
