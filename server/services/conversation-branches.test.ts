import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ContentPart, MessageStatus } from '@shared/types/domain'
import type { ReasoningReplayContextV1 } from '../provider/reasoning-replay'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let branches: typeof import('./conversation-branches')
let conversationServices: typeof import('./conversations')
let shareServices: typeof import('./shares')
let storage: typeof import('../storage/files')
let seq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-conversation-branches-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-conversation-branches'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  storage = await import('../storage/files')
  branches = await import('./conversation-branches')
  conversationServices = await import('./conversations')
  shareServices = await import('./shares')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

async function createUser() {
  const n = seq++
  const [user] = await dbClient.db
    .insert(schema.users)
    .values({ username: `branch-user-${n}`, passwordHash: 'hash' })
    .returning()
  if (!user) throw new Error('Failed to create user')
  return user
}

async function createModel() {
  const n = seq++
  const [provider] = await dbClient.db
    .insert(schema.providers)
    .values({
      name: `branch-provider-${n}`,
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
    })
    .returning()
  if (!provider) throw new Error('Failed to create provider')
  const [model] = await dbClient.db
    .insert(schema.models)
    .values({
      providerId: provider.id,
      modelId: `branch-model-${n}`,
      displayName: 'Branch model',
      capabilities: {
        vision: true,
        file_input: true,
        web_search: true,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: [{ value: 'high', description: '深度思考' }],
      defaultEffort: 'high',
      defaultWebSearch: false,
    })
    .returning()
  if (!model) throw new Error('Failed to create model')
  return model
}

async function addMessage(input: {
  conversationId: string
  parentId?: string | null
  role: 'user' | 'assistant'
  content: ContentPart[]
  status?: MessageStatus
  modelId?: string | null
  runtimeContext?: string | null
  reasoningSummary?: string | null
  reasoningReplayContext?: ReasoningReplayContextV1 | null
}) {
  const [message] = await dbClient.db
    .insert(schema.messages)
    .values({
      conversationId: input.conversationId,
      parentId: input.parentId ?? null,
      role: input.role,
      status: input.status ?? 'complete',
      content: input.content,
      modelId: input.modelId ?? null,
      runtimeContext: input.runtimeContext ?? null,
      reasoningSummary: input.reasoningSummary ?? null,
      reasoningReplayContext: input.reasoningReplayContext ?? null,
    })
    .returning()
  if (!message) throw new Error('Failed to create message')
  return message
}

function userUploadFiles(userId: string): string[] {
  const dir = join(tmpDir, 'uploads', userId)
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

describe('createConversationBranch', () => {
  it('copies the target path, timing snapshots, continuation settings, and independent attachments', async () => {
    const user = await createUser()
    const model = await createModel()
    const [folder] = await dbClient.db
      .insert(schema.folders)
      .values({ userId: user.id, name: '研究' })
      .returning()
    if (!folder) throw new Error('Failed to create folder')
    const [sourceConversation] = await dbClient.db
      .insert(schema.conversations)
      .values({
        userId: user.id,
        title: '原对话',
        modelId: model.id,
        folderId: folder.id,
        pinnedAt: new Date(),
      })
      .returning()
    if (!sourceConversation) throw new Error('Failed to create conversation')

    const sourceFileId = `source-file-${seq++}`
    const root = await addMessage({
      conversationId: sourceConversation.id,
      role: 'user',
      runtimeContext: 'runtime-context-snapshot',
      content: [
        { type: 'input_text', text: '第一问' },
        { type: 'input_file', attachment_id: sourceFileId, filename: 'notes.txt' },
      ],
    })
    const sourceFilePath = storage.saveUpload(
      user.id,
      sourceFileId,
      'notes.txt',
      'text/plain',
      Buffer.from('branch-file'),
    )
    await dbClient.db.insert(schema.attachments).values({
      id: sourceFileId,
      userId: user.id,
      messageId: root.id,
      kind: 'file',
      mime: 'text/plain',
      filename: 'notes.txt',
      byteSize: 11,
      storagePath: sourceFilePath,
      sha256: storage.sha256(Buffer.from('branch-file')),
    })

    const firstAssistant = await addMessage({
      conversationId: sourceConversation.id,
      parentId: root.id,
      role: 'assistant',
      modelId: model.id,
      content: [{ type: 'output_text', text: '第一答', annotations: [] }],
    })
    const secondUser = await addMessage({
      conversationId: sourceConversation.id,
      parentId: firstAssistant.id,
      role: 'user',
      content: [{ type: 'input_text', text: '第二问' }],
    })

    const generatedImageId = `source-image-${seq++}`
    const reasoningReplayContext = {
      version: 1 as const,
      source: {
        providerId: model.providerId,
        providerBaseUrl: 'https://example.test/v1',
        upstreamModelId: model.modelId,
      },
      reasoningContext: 'all_turns',
      items: [
        {
          id: 'branch-reasoning-item',
          type: 'reasoning',
          content: [],
          encrypted_content: 'opaque-branch-ciphertext',
          summary: [],
        },
      ],
    }
    const targetAssistant = await addMessage({
      conversationId: sourceConversation.id,
      parentId: secondUser.id,
      role: 'assistant',
      modelId: model.id,
      reasoningSummary: '**已思考**',
      reasoningReplayContext,
      content: [
        { type: 'output_text', text: '目标回答', annotations: [] },
        { type: 'image_result', attachment_id: generatedImageId, revised_prompt: '测试图片' },
      ],
    })
    const generatedImagePath = storage.saveUpload(
      user.id,
      generatedImageId,
      'generated.png',
      'image/png',
      Buffer.from('branch-image'),
    )
    await dbClient.db.insert(schema.attachments).values({
      id: generatedImageId,
      userId: user.id,
      messageId: targetAssistant.id,
      kind: 'image',
      mime: 'image/png',
      filename: 'generated.png',
      byteSize: 12,
      storagePath: generatedImagePath,
      sha256: storage.sha256(Buffer.from('branch-image')),
    })
    const runStartedAt = new Date(Date.UTC(2026, 6, 17, 8, 0, 0))
    const runFinishedAt = new Date(runStartedAt.getTime() + 20_000)
    const [targetRun] = await dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: sourceConversation.id,
        userId: user.id,
        assistantMessageId: targetAssistant.id,
        modelId: model.id,
        state: 'completed',
        requestParams: {
          web_search: true,
          reasoning_effort: 'high',
          clientLocale: 'zh-CN',
        },
        startedAt: runStartedAt,
        finishedAt: runFinishedAt,
      })
      .returning()
    if (!targetRun) throw new Error('Failed to create target run')
    await dbClient.db.insert(schema.runEvents).values([
      {
        runId: targetRun.id,
        sequenceNumber: 0,
        type: 'response.created',
        data: {},
        createdAt: new Date(runStartedAt.getTime() + 1_000),
      },
      {
        runId: targetRun.id,
        sequenceNumber: 1,
        type: 'response.output_text.delta',
        data: { delta: '目标' },
        createdAt: new Date(runStartedAt.getTime() + 6_000),
      },
      {
        runId: targetRun.id,
        sequenceNumber: 2,
        type: 'run.done',
        data: { state: 'completed' },
        createdAt: new Date(runFinishedAt.getTime() + 5),
      },
    ])
    await dbClient.db
      .update(schema.messages)
      .set({
        runId: targetRun.id,
        // run 现算值必须优先于可能过时的消息快照。
        reasoningDurationMs: 321,
        generationDurationMs: 654,
        inputTokens: 120,
        cachedTokens: 80,
        outputTokens: 30,
        reasoningTokens: 10,
        totalTokens: 150,
      })
      .where(eq(schema.messages.id, targetAssistant.id))

    const laterUser = await addMessage({
      conversationId: sourceConversation.id,
      parentId: targetAssistant.id,
      role: 'user',
      content: [{ type: 'input_text', text: '不应复制的后续' }],
    })
    const laterAssistant = await addMessage({
      conversationId: sourceConversation.id,
      parentId: laterUser.id,
      role: 'assistant',
      content: [{ type: 'output_text', text: '不应复制的后续回答', annotations: [] }],
    })
    await addMessage({
      conversationId: sourceConversation.id,
      parentId: secondUser.id,
      role: 'assistant',
      content: [{ type: 'output_text', text: '不应复制的兄弟分支', annotations: [] }],
    })
    await dbClient.db
      .update(schema.conversations)
      .set({ activeLeafId: laterAssistant.id })
      .where(eq(schema.conversations.id, sourceConversation.id))

    const result = await branches.createConversationBranch(
      user.id,
      sourceConversation.id,
      targetAssistant.id,
    )
    if (!result.ok) throw new Error(result.message)

    const branchConversation = await conversationServices.getOwnedConversation(
      user.id,
      result.conversationId,
    )
    expect(branchConversation).toMatchObject({
      title: '分支 • 原对话',
      modelId: model.id,
      folderId: folder.id,
      pinnedAt: null,
      paramsOverride: { web_search: true, reasoning_effort: 'high' },
    })

    const copiedMessages = await conversationServices.getConversationMessages(result.conversationId)
    const copiedPath = conversationServices.buildPath(
      copiedMessages,
      branchConversation?.activeLeafId ?? null,
    )
    expect(copiedPath).toHaveLength(4)
    expect(copiedPath.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(JSON.stringify(copiedPath.map((message) => message.content))).toContain('目标回答')
    expect(JSON.stringify(copiedPath.map((message) => message.content))).not.toContain('不应复制')
    expect(copiedPath.every((message) => message.runId === null)).toBe(true)
    expect(copiedPath[0]?.runtimeContext).toBe('runtime-context-snapshot')
    expect(copiedPath.at(-1)).toMatchObject({
      reasoningSummary: '**已思考**',
      reasoningReplayContext,
      reasoningDurationMs: 5_000,
      generationDurationMs: 20_000,
      inputTokens: 120,
      cachedTokens: 80,
      outputTokens: 30,
      reasoningTokens: 10,
      totalTokens: 150,
    })
    expect(new Set(copiedPath.map((message) => message.id)).size).toBe(4)
    expect(copiedPath[0]?.parentId).toBeNull()
    copiedPath.slice(1).forEach((message, index) => {
      expect(message.parentId).toBe(copiedPath[index]?.id)
    })

    const copiedMessageIds = copiedMessages.map((message) => message.id)
    const copiedAttachmentRows = await dbClient.db
      .select()
      .from(schema.attachments)
      .where(inArray(schema.attachments.messageId, copiedMessageIds))
    expect(copiedAttachmentRows).toHaveLength(2)
    expect(copiedAttachmentRows.map((attachment) => attachment.id)).not.toContain(sourceFileId)
    expect(copiedAttachmentRows.map((attachment) => attachment.id)).not.toContain(generatedImageId)
    expect(copiedAttachmentRows.every((attachment) => existsSync(attachment.storagePath))).toBe(
      true,
    )
    expect(
      copiedAttachmentRows.map((attachment) =>
        storage.readUpload(attachment.storagePath).toString(),
      ),
    ).toEqual(expect.arrayContaining(['branch-file', 'branch-image']))
    expect(
      copiedPath.flatMap((message) =>
        message.content.flatMap((part) => ('attachment_id' in part ? [part.attachment_id] : [])),
      ),
    ).toEqual(expect.arrayContaining(copiedAttachmentRows.map((attachment) => attachment.id)))

    expect(
      await dbClient.db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.conversationId, result.conversationId)),
    ).toHaveLength(0)
    const copiedMessageDto = (
      await conversationServices.getConversationMessageDTOs(result.conversationId)
    ).find((message) => message.id === copiedPath.at(-1)?.id)
    expect(copiedMessageDto).toMatchObject({
      runId: null,
      reasoningDurationMs: 5_000,
      generationDurationMs: 20_000,
    })
    expect(copiedMessageDto).not.toHaveProperty('reasoningReplayContext')
    expect(JSON.stringify(copiedMessageDto)).not.toContain('opaque-branch-ciphertext')

    const shareResult = await shareServices.createShare(user.id, result.conversationId, {
      showAvatar: false,
      showName: false,
      expiresInDays: null,
    })
    expect(shareResult.ok).toBe(true)
    const [shareRow] = await dbClient.db
      .select({ snapshot: schema.sharedChats.snapshot })
      .from(schema.sharedChats)
      .where(eq(schema.sharedChats.conversationId, result.conversationId))
      .limit(1)
    expect(JSON.stringify(shareRow?.snapshot)).not.toContain('reasoningReplayContext')
    expect(JSON.stringify(shareRow?.snapshot)).not.toContain('opaque-branch-ciphertext')
    expect(await conversationServices.getConversationLastRun(result.conversationId)).toEqual({
      modelId: model.id,
      params: { web_search: true, reasoning_effort: 'high' },
    })

    await conversationServices.deleteConversations(user.id, [sourceConversation.id])
    expect(existsSync(sourceFilePath)).toBe(false)
    expect(existsSync(generatedImagePath)).toBe(false)
    expect(copiedAttachmentRows.every((attachment) => existsSync(attachment.storagePath))).toBe(
      true,
    )

    // 删除原会话及其 run/events 后，分支仍由消息快照展示耗时，也能继续创建独立分支。
    expect(
      (await conversationServices.getConversationMessageDTOs(result.conversationId)).find(
        (message) => message.id === copiedPath.at(-1)?.id,
      ),
    ).toMatchObject({
      reasoningDurationMs: 5_000,
      generationDurationMs: 20_000,
    })
    const nestedResult = await branches.createConversationBranch(
      user.id,
      result.conversationId,
      copiedPath.at(-1)!.id,
    )
    expect(nestedResult.ok).toBe(true)
    if (!nestedResult.ok) throw new Error(nestedResult.message)
    const nestedMessages = await conversationServices.getConversationMessages(
      nestedResult.conversationId,
    )
    const nestedConversation = await conversationServices.getOwnedConversation(
      user.id,
      nestedResult.conversationId,
    )
    const nestedTarget = conversationServices
      .buildPath(nestedMessages, nestedConversation?.activeLeafId ?? null)
      .at(-1)
    expect(nestedTarget).toMatchObject({
      runId: null,
      reasoningReplayContext,
      reasoningDurationMs: 5_000,
      generationDurationMs: 20_000,
    })

    await conversationServices.deleteConversations(user.id, [result.conversationId])
    expect(copiedAttachmentRows.every((attachment) => !existsSync(attachment.storagePath))).toBe(
      true,
    )
    expect(
      (await conversationServices.getConversationMessageDTOs(nestedResult.conversationId)).find(
        (message) => message.id === nestedTarget?.id,
      ),
    ).toMatchObject({
      reasoningDurationMs: 5_000,
      generationDurationMs: 20_000,
    })
    await conversationServices.deleteConversations(user.id, [nestedResult.conversationId])
  })

  it('rejects invalid ownership, user-message targets, and incomplete message paths', async () => {
    const owner = await createUser()
    const other = await createUser()
    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: owner.id, title: null })
      .returning()
    if (!conversation) throw new Error('Failed to create conversation')
    const root = await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'input_text', text: '根消息' }],
    })
    const streamingAssistant = await addMessage({
      conversationId: conversation.id,
      parentId: root.id,
      role: 'assistant',
      status: 'streaming',
      content: [],
    })
    const brokenAssistant = await addMessage({
      conversationId: conversation.id,
      parentId: 'missing-parent',
      role: 'assistant',
      content: [{ type: 'output_text', text: '孤儿消息', annotations: [] }],
    })

    await expect(
      branches.createConversationBranch(other.id, conversation.id, streamingAssistant.id),
    ).resolves.toMatchObject({ ok: false, status: 404, code: 'not_found' })
    await expect(
      branches.createConversationBranch(owner.id, conversation.id, root.id),
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
      code: 'assistant_message_required',
    })
    await expect(
      branches.createConversationBranch(owner.id, conversation.id, streamingAssistant.id),
    ).resolves.toMatchObject({ ok: false, status: 409, code: 'message_not_ready' })
    await expect(
      branches.createConversationBranch(owner.id, conversation.id, brokenAssistant.id),
    ).resolves.toMatchObject({ ok: false, status: 409, code: 'invalid_message_tree' })
    expect(branches.branchConversationTitle(null)).toBe('分支 • 新聊天')
    const emojiTitle = branches.branchConversationTitle('😀'.repeat(120))
    expect(emojiTitle.length).toBeLessThanOrEqual(120)
    expect(emojiTitle).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  it('leaves no conversations, attachment rows, or files when clear-all races branch creation', async () => {
    const user = await createUser()
    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id, title: '并发清空' })
      .returning()
    if (!conversation) throw new Error('Failed to create conversation')

    const attachmentId = `clear-race-attachment-${seq++}`
    const root = await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'input_file', attachment_id: attachmentId, filename: 'race.txt' }],
    })
    const target = await addMessage({
      conversationId: conversation.id,
      parentId: root.id,
      role: 'assistant',
      content: [{ type: 'output_text', text: '回答', annotations: [] }],
    })
    const sourcePath = storage.saveUpload(
      user.id,
      attachmentId,
      'race.txt',
      'text/plain',
      Buffer.from('race'),
    )
    await dbClient.db.insert(schema.attachments).values({
      id: attachmentId,
      userId: user.id,
      messageId: root.id,
      kind: 'file',
      mime: 'text/plain',
      filename: 'race.txt',
      byteSize: 4,
      storagePath: sourcePath,
    })

    await Promise.all([
      branches.createConversationBranch(user.id, conversation.id, target.id),
      conversationServices.clearAllConversations(user.id),
    ])

    expect(
      await dbClient.db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.userId, user.id)),
    ).toHaveLength(0)
    expect(
      await dbClient.db
        .select()
        .from(schema.attachments)
        .where(eq(schema.attachments.userId, user.id)),
    ).toHaveLength(0)
    expect(userUploadFiles(user.id)).toEqual([])
  })

  it('cleans partially copied files when a referenced source file is missing', async () => {
    const user = await createUser()
    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id, title: '损坏附件' })
      .returning()
    if (!conversation) throw new Error('Failed to create conversation')

    const validAttachmentId = `valid-attachment-${seq++}`
    const missingAttachmentId = `missing-attachment-${seq++}`
    const root = await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [
        { type: 'input_file', attachment_id: validAttachmentId, filename: 'valid.txt' },
        { type: 'input_file', attachment_id: missingAttachmentId, filename: 'missing.txt' },
      ],
    })
    const target = await addMessage({
      conversationId: conversation.id,
      parentId: root.id,
      role: 'assistant',
      content: [{ type: 'output_text', text: '回答', annotations: [] }],
    })
    const validPath = storage.saveUpload(
      user.id,
      validAttachmentId,
      'valid.txt',
      'text/plain',
      Buffer.from('valid'),
    )
    await dbClient.db.insert(schema.attachments).values([
      {
        id: validAttachmentId,
        userId: user.id,
        messageId: root.id,
        kind: 'file',
        mime: 'text/plain',
        filename: 'valid.txt',
        byteSize: 5,
        storagePath: validPath,
      },
      {
        id: missingAttachmentId,
        userId: user.id,
        messageId: root.id,
        kind: 'file',
        mime: 'text/plain',
        filename: 'missing.txt',
        byteSize: 7,
        storagePath: join(tmpDir, 'missing-source.txt'),
      },
    ])
    const beforeFiles = userUploadFiles(user.id)
    const beforeConversations = await dbClient.db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.userId, user.id))

    await expect(
      branches.createConversationBranch(user.id, conversation.id, target.id),
    ).resolves.toMatchObject({ ok: false, status: 409, code: 'attachment_unavailable' })
    expect(userUploadFiles(user.id)).toEqual(beforeFiles)
    expect(
      await dbClient.db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.userId, user.id)),
    ).toHaveLength(beforeConversations.length)
    expect(
      await dbClient.db
        .select()
        .from(schema.attachments)
        .where(
          and(
            eq(schema.attachments.userId, user.id),
            inArray(schema.attachments.id, [validAttachmentId, missingAttachmentId]),
          ),
        ),
    ).toHaveLength(2)
  })
})
