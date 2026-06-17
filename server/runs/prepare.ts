import { eq, inArray } from 'drizzle-orm'
import type { ContentPart, ModelParams } from '@shared/types/domain'
import { db } from '../db/client'
import { attachments, conversations, messages, runs } from '../db/schema'
import { must } from '../lib/assert'
import { buildInput, type ResolvedAttachment } from '../provider/context'
import { buildImageBody, buildResponseBody } from '../provider/params'
import { buildPath, getConversationMessages, getOwnedConversation } from '../services/conversations'
import { getRunnableModel } from '../services/models'
import { toDataUrl } from '../storage/files'
import type { ConvRow, ModelRow, MsgRow, ProviderRow, RunRow } from './types'

export interface AttachmentRef {
  attachmentId: string
  kind: 'image' | 'file'
  filename: string
  detail?: 'auto' | 'low' | 'high'
}

export interface PreparedRun {
  ok: true
  conversation: ConvRow
  userMessage: MsgRow | null
  assistantMessage: MsgRow
  run: RunRow
  model: ModelRow
  provider: ProviderRow
  body: Record<string, unknown>
}
export type PrepareError = { ok: false; status: 400 | 404; message: string; code: string }
export type PrepareResult = PreparedRun | PrepareError

/** 读取路径中引用的附件为内联 data URL（请求构建用）。 */
async function resolveAttachments(pathMessages: MsgRow[]): Promise<Map<string, ResolvedAttachment>> {
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
  const rows = await db.select().from(attachments).where(inArray(attachments.id, [...ids]))
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

async function createAssistantAndRun(opts: {
  conversation: ConvRow
  model: ModelRow
  parentMessageId: string
  userParams?: ModelParams
  idempotencyKey?: string
}): Promise<{ assistantMessage: MsgRow; run: RunRow; body: Record<string, unknown> }> {
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

  await db
    .update(conversations)
    .set({ activeLeafId: assistantMessage.id, modelId: model.id, updatedAt: new Date() })
    .where(eq(conversations.id, conv.id))

  const all = await getConversationMessages(conv.id)
  const path = buildPath(all, parentMessageId)

  let body: Record<string, unknown>
  if (model.kind === 'image') {
    const userMsg = path[path.length - 1]
    const prompt = (userMsg?.content ?? [])
      .map((p) => (p.type === 'input_text' ? p.text : ''))
      .join('\n')
      .trim()
    body = buildImageBody(model, prompt, userParams)
  } else {
    const attMap = await resolveAttachments(path)
    const input = buildInput(
      path.map((m) => ({ role: m.role, content: m.content })),
      attMap,
    )
    const instructions = conv.systemPromptOverride ?? model.defaultSystemPrompt
    body = buildResponseBody({ model, input, instructions, userParams, stream: true })
  }

  return { assistantMessage, run, body }
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
}

export async function prepareRun(args: PrepareArgs): Promise<PrepareResult> {
  const runnable = await getRunnableModel(args.modelId)
  if (!runnable) return { ok: false, status: 400, message: '所选模型不可用', code: 'model_unavailable' }
  const { model, provider } = runnable

  const refs = args.attachments ?? []
  if (refs.length > 0) {
    const rows = await db
      .select()
      .from(attachments)
      .where(inArray(attachments.id, refs.map((r) => r.attachmentId)))
    const owned = new Set(rows.filter((a) => a.userId === args.userId).map((a) => a.id))
    if (refs.some((r) => !owned.has(r.attachmentId))) {
      return { ok: false, status: 400, message: '附件无效或无权访问', code: 'invalid_attachment' }
    }
    if (refs.some((r) => r.kind === 'image') && !model.capabilities.vision) {
      return { ok: false, status: 400, message: '该模型不支持图片输入', code: 'no_vision' }
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
        .values({ userId: args.userId, modelId: model.id, title: args.text.slice(0, 30) || '新对话' })
        .returning()
        .then((r) => r[0]),
    )
  }

  const parentId = args.parentId !== undefined ? args.parentId : conv.activeLeafId
  const userContent: ContentPart[] = []
  if (args.text.trim()) userContent.push({ type: 'input_text', text: args.text })
  for (const r of refs) {
    if (r.kind === 'image') {
      userContent.push({ type: 'input_image', attachment_id: r.attachmentId, detail: r.detail ?? 'auto' })
    } else {
      userContent.push({ type: 'input_file', attachment_id: r.attachmentId, filename: r.filename })
    }
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
      .where(inArray(attachments.id, refs.map((r) => r.attachmentId)))
  }

  const { assistantMessage, run, body } = await createAssistantAndRun({
    conversation: conv,
    model,
    parentMessageId: userMessage.id,
    userParams: args.params,
    idempotencyKey: args.idempotencyKey,
  })

  return { ok: true, conversation: conv, userMessage, assistantMessage, run, model, provider, body }
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
  if (!runnable) return { ok: false, status: 400, message: '所选模型不可用', code: 'model_unavailable' }
  const { model, provider } = runnable

  const { assistantMessage, run, body } = await createAssistantAndRun({
    conversation: conv,
    model,
    parentMessageId: oldAssistant.parentId,
    userParams: args.params,
    idempotencyKey: args.idempotencyKey,
  })

  return { ok: true, conversation: conv, userMessage: null, assistantMessage, run, model, provider, body }
}
