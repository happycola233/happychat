import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let prepare: typeof import('./prepare')
let conversationServices: typeof import('../services/conversations')
let storage: typeof import('../storage/files')
let fixtureSeq = 0

type PrepareModule = typeof import('./prepare')
type PreparedRunResult = Extract<Awaited<ReturnType<PrepareModule['prepareRun']>>, { ok: true }>
type PreparedRunWithUser = PreparedRunResult & {
  userMessage: NonNullable<PreparedRunResult['userMessage']>
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-prepare-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-prepare'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  prepare = await import('./prepare')
  conversationServices = await import('../services/conversations')
  storage = await import('../storage/files')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

async function createRunnableModel() {
  const n = fixtureSeq++
  const userId = `user-${n}`
  const providerId = `provider-${n}`
  const modelId = `model-${n}`

  await dbClient.db.insert(schema.users).values({
    id: userId,
    username: `user-${n}`,
    passwordHash: 'hash',
  })
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: `Provider ${n}`,
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
  })
  await dbClient.db.insert(schema.models).values({
    id: modelId,
    providerId,
    modelId: `test-model-${n}`,
    displayName: `Test Model ${n}`,
    kind: 'responses',
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      image_generation: false,
      reasoning: false,
    },
  })

  return { userId, modelId, providerId }
}

async function createRunnableImageModel() {
  const n = fixtureSeq++
  const userId = `user-${n}`
  const providerId = `provider-${n}`
  const modelId = `model-${n}`

  await dbClient.db.insert(schema.users).values({
    id: userId,
    username: `user-${n}`,
    passwordHash: 'hash',
  })
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: `Provider ${n}`,
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
  })
  await dbClient.db.insert(schema.models).values({
    id: modelId,
    providerId,
    modelId: 'gpt-image-2',
    displayName: `Image Model ${n}`,
    kind: 'image',
    capabilities: {
      vision: true,
      file_input: false,
      web_search: false,
      image_generation: true,
      reasoning: false,
    },
  })

  return { userId, modelId }
}

async function createImageAttachment(
  userId: string,
  mime = 'image/png',
  filename = 'reference.png',
  messageId?: string,
) {
  const n = fixtureSeq++
  const attachmentId = `attachment-${n}`
  const bytes = Buffer.from('image-bytes')
  const storagePath = storage.saveUpload(userId, attachmentId, filename, mime, bytes)

  await dbClient.db.insert(schema.attachments).values({
    id: attachmentId,
    userId,
    kind: 'image',
    mime,
    filename,
    byteSize: bytes.length,
    storagePath,
    messageId,
  })

  return { attachmentId, filename }
}

async function createRunnableFileModel() {
  const runnable = await createRunnableModel()
  dbClient.sqlite.prepare('update models set capabilities = ? where id = ?').run(
    JSON.stringify({
      vision: false,
      file_input: true,
      web_search: false,
      image_generation: false,
      reasoning: false,
    }),
    runnable.modelId,
  )
  return runnable
}

async function createFileAttachment(
  userId: string,
  options: { filename?: string; mime?: string; byteSize?: number } = {},
) {
  const n = fixtureSeq++
  const attachmentId = `file-attachment-${n}`
  const filename = options.filename ?? `diagnostic-${n}.log`
  const mime = options.mime ?? 'application/octet-stream'
  const bytes = Buffer.from('small fixture; byteSize is metadata for budget tests')
  const storagePath = storage.saveUpload(userId, attachmentId, filename, mime, bytes)

  await dbClient.db.insert(schema.attachments).values({
    id: attachmentId,
    userId,
    kind: 'file',
    mime,
    filename,
    byteSize: options.byteSize ?? bytes.length,
    storagePath,
  })

  return { attachmentId, filename, kind: 'file' as const }
}

function assertPrepared(
  result: Awaited<ReturnType<PrepareModule['prepareRun']>>,
): PreparedRunWithUser {
  if (!result.ok) throw new Error(result.message)
  if (!result.userMessage) throw new Error('Expected user message')
  return result as PreparedRunWithUser
}

describe('prepareRun active leaf', () => {
  it('returns a new conversation with activeLeafId set to the assistant placeholder', async () => {
    const { userId, modelId } = await createRunnableModel()

    const result = assertPrepared(await prepare.prepareRun({ userId, modelId, text: 'hello' }))

    expect(result.conversation.activeLeafId).toBe(result.assistantMessage.id)

    const all = await conversationServices.getConversationMessages(result.conversation.id)
    const path = conversationServices.buildPath(all, result.conversation.activeLeafId)
    expect(path.map((m) => m.id)).toEqual([result.userMessage.id, result.assistantMessage.id])
  })

  it('uses admin web search defaults for new runs without persisting a synthetic override', async () => {
    const { userId, modelId } = await createRunnableModel()
    dbClient.sqlite
      .prepare('update models set capabilities = ?, default_web_search = 1 where id = ?')
      .run(
        JSON.stringify({
          vision: false,
          file_input: false,
          web_search: true,
          image_generation: false,
          reasoning: false,
        }),
        modelId,
      )

    const result = assertPrepared(
      await prepare.prepareRun({ userId, modelId, text: '需要查一下今天的信息', params: {} }),
    )
    const lastRun = await conversationServices.getConversationLastRun(result.conversation.id)

    expect(result.body.tools).toEqual([{ type: 'web_search' }])
    expect(result.run.requestParams).not.toHaveProperty('web_search')
    expect(lastRun.params?.web_search).toBe(true)
  })

  it('drops a pinned reasoning effort unsupported by the selected model', async () => {
    const { userId, modelId } = await createRunnableModel()
    dbClient.sqlite
      .prepare(
        'update models set capabilities = ?, allowed_efforts = ?, default_effort = ? where id = ?',
      )
      .run(
        JSON.stringify({
          vision: false,
          file_input: false,
          web_search: false,
          image_generation: false,
          reasoning: true,
        }),
        JSON.stringify(['low', 'medium']),
        'low',
        modelId,
      )

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'hello',
        params: { reasoning_effort: 'xhigh' },
      }),
    )
    const lastRun = await conversationServices.getConversationLastRun(result.conversation.id)

    expect(result.body.reasoning).toEqual({ effort: 'low' })
    expect(result.run.requestParams).not.toHaveProperty('reasoning_effort')
    expect(lastRun.params?.reasoning_effort).toBe('low')
  })

  it('continues an existing conversation from the previous active leaf', async () => {
    const { userId, modelId } = await createRunnableModel()
    const first = assertPrepared(await prepare.prepareRun({ userId, modelId, text: 'first' }))

    const second = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        conversationId: first.conversation.id,
        text: 'second',
      }),
    )

    expect(second.conversation.activeLeafId).toBe(second.assistantMessage.id)
    expect(second.userMessage.parentId).toBe(first.assistantMessage.id)

    const all = await conversationServices.getConversationMessages(second.conversation.id)
    const path = conversationServices.buildPath(all, second.conversation.activeLeafId)
    expect(path.map((m) => m.id)).toEqual([
      first.userMessage.id,
      first.assistantMessage.id,
      second.userMessage.id,
      second.assistantMessage.id,
    ])
  })

  it('replays assistant generated images as visual context for the next Responses run', async () => {
    const { userId, modelId } = await createRunnableModel()
    dbClient.sqlite.prepare('update models set capabilities = ? where id = ?').run(
      JSON.stringify({
        vision: true,
        file_input: false,
        web_search: false,
        image_generation: false,
        reasoning: false,
      }),
      modelId,
    )
    const first = assertPrepared(await prepare.prepareRun({ userId, modelId, text: '画一颗星星' }))
    const generated = await createImageAttachment(
      userId,
      'image/png',
      'generated.png',
      first.assistantMessage.id,
    )
    dbClient.sqlite.prepare('update messages set status = ?, content = ? where id = ?').run(
      'complete',
      JSON.stringify([
        { type: 'output_text', text: '已生成。' },
        { type: 'image_result', attachment_id: generated.attachmentId },
      ]),
      first.assistantMessage.id,
    )

    const second = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        conversationId: first.conversation.id,
        text: '把刚才那张图改成红色',
      }),
    )

    expect(second.body.input).toEqual(
      expect.arrayContaining([
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Context: The following image was generated by the assistant earlier in this conversation. Treat it as visual context for subsequent user requests.',
            },
            {
              type: 'input_image',
              detail: 'auto',
              image_url: expect.stringMatching(/^data:image\/png;base64,/),
            },
          ],
        },
      ]),
    )
  })

  it('returns the regenerated assistant branch as the active leaf', async () => {
    const { userId, modelId } = await createRunnableModel()
    const first = assertPrepared(await prepare.prepareRun({ userId, modelId, text: 'first' }))

    const regenerated = await prepare.prepareRegenerate({
      userId,
      modelId,
      assistantMessageId: first.assistantMessage.id,
    })
    if (!regenerated.ok) throw new Error(regenerated.message)

    expect(regenerated.conversation.activeLeafId).toBe(regenerated.assistantMessage.id)
    expect(regenerated.assistantMessage.parentId).toBe(first.userMessage.id)

    const all = await conversationServices.getConversationMessages(regenerated.conversation.id)
    const path = conversationServices.buildPath(all, regenerated.conversation.activeLeafId)
    expect(path.map((m) => m.id)).toEqual([first.userMessage.id, regenerated.assistantMessage.id])
  })

  it('freezes runtime context on the user message and emits a stable cache key', async () => {
    const { userId, modelId } = await createRunnableModel()

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'hello',
        clientTimezone: 'Asia/Shanghai',
      }),
    )
    const input = result.body.input as Array<Record<string, unknown>>

    expect(result.userMessage.runtimeContext).toMatch(
      /^<runtime_context>\ndatetime: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00\ntimezone: Asia\/Shanghai\n<\/runtime_context>$/,
    )
    expect(input[0]).toEqual({
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text: result.userMessage.runtimeContext }],
    })
    expect(input[1]).toMatchObject({ type: 'message', role: 'user' })
    expect(result.body.prompt_cache_key).toBe(`happychat:conversation:${result.conversation.id}`)
    expect(result.body).not.toHaveProperty('prompt_cache_retention')
    expect(result.body.instructions).toContain('<runtime_context_protocol>')
  })

  it('uses the latest admin model prompt in an existing conversation', async () => {
    const { userId, modelId } = await createRunnableModel()
    dbClient.sqlite
      .prepare('update models set default_system_prompt = ? where id = ?')
      .run('Old instructions.', modelId)
    const first = assertPrepared(await prepare.prepareRun({ userId, modelId, text: 'first' }))

    dbClient.sqlite
      .prepare('update conversations set system_prompt_override = ? where id = ?')
      .run('Stale conversation override.', first.conversation.id)
    dbClient.sqlite
      .prepare('update models set default_system_prompt = ? where id = ?')
      .run('New instructions.', modelId)
    const second = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        conversationId: first.conversation.id,
        text: 'second',
      }),
    )

    expect(second.body.instructions).toMatch(/^New instructions\./)
    expect(second.body.instructions).not.toContain('Old instructions.')
    expect(second.body.instructions).not.toContain('Stale conversation override.')
  })

  it('reuses the original user runtime context when regenerating', async () => {
    const { userId, modelId } = await createRunnableModel()
    const first = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'first',
        clientTimezone: 'Asia/Shanghai',
      }),
    )

    const regenerated = await prepare.prepareRegenerate({
      userId,
      modelId,
      assistantMessageId: first.assistantMessage.id,
    })
    if (!regenerated.ok) throw new Error(regenerated.message)
    const input = regenerated.body.input as Array<Record<string, unknown>>

    expect(input[0]).toEqual({
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text: first.userMessage.runtimeContext }],
    })
  })

  it('lets advanced hard params override the key and pass prompt_cache_retention unchanged', async () => {
    const { userId, modelId } = await createRunnableModel()
    dbClient.sqlite
      .prepare('update models set hard_params = ? where id = ?')
      .run(
        JSON.stringify({ prompt_cache_key: 'manual-key', prompt_cache_retention: '24h' }),
        modelId,
      )

    const result = assertPrepared(await prepare.prepareRun({ userId, modelId, text: 'hello' }))

    expect(result.body.prompt_cache_key).toBe('manual-key')
    expect(result.body.prompt_cache_retention).toBe('24h')
  })
})

describe('prepareRun model user access', () => {
  it('rejects a forged restricted model id before creating conversation data', async () => {
    const { userId, modelId } = await createRunnableModel()
    const allowedUserId = `allowed-user-${fixtureSeq++}`
    await dbClient.db.insert(schema.users).values({
      id: allowedUserId,
      username: allowedUserId,
      passwordHash: 'hash',
    })
    await dbClient.db
      .update(schema.models)
      .set({ accessMode: 'selected' })
      .where(eq(schema.models.id, modelId))
    await dbClient.db.insert(schema.modelUserAccess).values({ modelId, userId: allowedUserId })

    const result = await prepare.prepareRun({ userId, modelId, text: 'hello' })

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: 'model_unavailable',
    })
    const conversations = await dbClient.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.userId, userId))
    expect(conversations).toEqual([])
  })

  it('rechecks access when regenerating with a previously allowed model', async () => {
    const { userId, modelId } = await createRunnableModel()
    const first = assertPrepared(await prepare.prepareRun({ userId, modelId, text: 'hello' }))
    const beforeMessages = await dbClient.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, first.conversation.id))

    await dbClient.db
      .update(schema.models)
      .set({ accessMode: 'selected' })
      .where(eq(schema.models.id, modelId))
    const regenerated = await prepare.prepareRegenerate({
      userId,
      assistantMessageId: first.assistantMessage.id,
    })

    expect(regenerated).toMatchObject({ ok: false, status: 400, code: 'model_unavailable' })
    const afterMessages = await dbClient.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, first.conversation.id))
    expect(afterMessages).toHaveLength(beforeMessages.length)
  })
})

describe('prepareRun file inputs', () => {
  it('repairs a historic application/octet-stream MIME using the .log extension', async () => {
    const { userId, modelId } = await createRunnableFileModel()
    const attachment = await createFileAttachment(userId)

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: '读取日志',
        attachments: [attachment],
      }),
    )

    expect(result.body).toMatchObject({
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: expect.stringMatching(/^<runtime_context>/),
            },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '读取日志' },
            {
              type: 'input_file',
              filename: attachment.filename,
              file_data: expect.stringMatching(/^data:text\/plain;base64,/),
            },
          ],
        },
      ],
    })
  })

  it('rejects a file whose size is exactly the exclusive 50 MB boundary', async () => {
    const { userId, modelId } = await createRunnableFileModel()
    const attachment = await createFileAttachment(userId, { byteSize: 50 * 1024 * 1024 })

    const result = await prepare.prepareRun({
      userId,
      modelId,
      text: '读取日志',
      attachments: [attachment],
    })

    expect(result).toMatchObject({ ok: false, code: 'file_too_large' })
  })

  it('counts historical branch files when enforcing the 50 MB request budget', async () => {
    const { userId, modelId } = await createRunnableFileModel()
    const firstAttachment = await createFileAttachment(userId, { byteSize: 30 * 1024 * 1024 })
    const first = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: '第一份文件',
        attachments: [firstAttachment],
      }),
    )
    const secondAttachment = await createFileAttachment(userId, { byteSize: 21 * 1024 * 1024 })

    const result = await prepare.prepareRun({
      userId,
      modelId,
      conversationId: first.conversation.id,
      text: '第二份文件',
      attachments: [secondAttachment],
    })

    expect(result).toMatchObject({ ok: false, code: 'file_request_too_large' })
  })

  it('allows multiple sub-50 MB files whose combined size is exactly 50 MB', async () => {
    const { userId, modelId } = await createRunnableFileModel()
    const firstAttachment = await createFileAttachment(userId, { byteSize: 25 * 1024 * 1024 })
    const secondAttachment = await createFileAttachment(userId, { byteSize: 25 * 1024 * 1024 })

    const result = await prepare.prepareRun({
      userId,
      modelId,
      text: '读取两份文件',
      attachments: [firstAttachment, secondAttachment],
    })

    expect(result.ok).toBe(true)
  })

  it('reuses a retained file attachment when editing a user message into a sibling branch', async () => {
    const { userId, modelId } = await createRunnableFileModel()
    const attachment = await createFileAttachment(userId, { filename: 'retained.txt' })
    const first = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: '原始文本',
        attachments: [attachment],
      }),
    )

    const edited = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        conversationId: first.conversation.id,
        parentId: first.userMessage.parentId,
        text: '编辑后的文本',
        attachments: [attachment],
      }),
    )

    expect(edited.userMessage.parentId).toBe(first.userMessage.parentId)
    expect(edited.userMessage.content).toContainEqual({
      type: 'input_file',
      attachment_id: attachment.attachmentId,
      filename: attachment.filename,
    })

    const [oldUserMessage] = await dbClient.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, first.userMessage.id))
      .limit(1)
    expect(oldUserMessage?.content).toContainEqual({
      type: 'input_file',
      attachment_id: attachment.attachmentId,
      filename: attachment.filename,
    })

    const attachmentRow = dbClient.sqlite
      .prepare('select message_id as messageId from attachments where id = ?')
      .get(attachment.attachmentId) as { messageId: string | null } | undefined
    expect(attachmentRow?.messageId).toBe(edited.userMessage.id)
  })
})

describe('prepareRun image inputs', () => {
  it('uses image edits when an image model receives image attachments', async () => {
    const { userId, modelId } = await createRunnableImageModel()
    const attachment = await createImageAttachment(userId)

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'Make this reference warmer',
        params: { image: { size: '1024x1024', quality: 'low' } },
        attachments: [{ ...attachment, kind: 'image' }],
      }),
    )

    expect(result.imageOperation).toBe('edit')
    expect(result.body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'Make this reference warmer',
      size: '1024x1024',
      quality: 'low',
      images: [{ image_url: expect.stringMatching(/^data:image\/png;base64,/) }],
    })
    expect(result.userMessage.content).toContainEqual({
      type: 'input_image',
      attachment_id: attachment.attachmentId,
      detail: 'auto',
    })
  })

  it('rejects a missing attachment file before creating the conversation or user message', async () => {
    const { userId, modelId } = await createRunnableImageModel()
    const attachment = await createImageAttachment(userId)
    const row = dbClient.sqlite
      .prepare('select storage_path as storagePath from attachments where id = ?')
      .get(attachment.attachmentId) as { storagePath: string }
    storage.removeUploadStrict(row.storagePath)

    const result = await prepare.prepareRun({
      userId,
      modelId,
      text: 'Use the missing reference',
      attachments: [{ ...attachment, kind: 'image' }],
    })

    expect(result).toMatchObject({ ok: false, status: 400, code: 'invalid_attachment' })
    const conversationCount = dbClient.sqlite
      .prepare('select count(*) as count from conversations where user_id = ?')
      .get(userId) as { count: number }
    expect(conversationCount.count).toBe(0)
  })

  it('keeps plain image prompts on the generation endpoint', async () => {
    const { userId, modelId } = await createRunnableImageModel()

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'Draw a blue square',
      }),
    )

    expect(result.imageOperation).toBe('generate')
    expect(result.body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'Draw a blue square',
    })
    expect(result.body.images).toBeUndefined()
  })

  it('normalizes valid custom gpt-image-2 sizes before building the upstream body', async () => {
    const { userId, modelId } = await createRunnableImageModel()

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'Draw a poster',
        params: { image: { size: ' 3840X2160 ', quality: 'high' } },
      }),
    )

    expect(result.body).toMatchObject({
      size: '3840x2160',
      quality: 'high',
    })
    expect(result.run.requestParams).toMatchObject({
      image: { size: '3840x2160', quality: 'high' },
    })
  })

  it('persists the browser locale separately from upstream request parameters', async () => {
    const { userId, modelId } = await createRunnableModel()

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'hello',
        params: { web_search: true },
        clientLocale: 'ja-JP',
      }),
    )

    expect(result.run.requestParams).toMatchObject({
      web_search: true,
      clientLocale: 'ja-JP',
    })
    expect(result.body).not.toHaveProperty('clientLocale')
  })

  it('renders the browser locale in model system prompt variables', async () => {
    const { userId, modelId } = await createRunnableModel()
    dbClient.sqlite
      .prepare('update models set default_system_prompt = ? where id = ?')
      .run('Reply using {{locale}}.', modelId)

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'hello',
        clientLocale: 'en-US',
      }),
    )

    const row = dbClient.sqlite
      .prepare('select instructions from runs where id = ?')
      .get(result.run.id) as { instructions: string | null } | undefined
    expect(row?.instructions).toMatch(/^Reply using .+ \(en-US\)\.\n\n<runtime_context_protocol>/)
  })

  it('rejects invalid gpt-image-2 sizes before creating a run', async () => {
    const { userId, modelId } = await createRunnableImageModel()

    const result = await prepare.prepareRun({
      userId,
      modelId,
      text: 'Draw a poster',
      params: { image: { size: '4000x1024' } },
    })

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: 'invalid_image_size',
    })
  })

  it('uses explicit existing image sources without reassigning their attachment message', async () => {
    const { userId, modelId } = await createRunnableImageModel()
    const attachment = await createImageAttachment(
      userId,
      'image/png',
      'generated.png',
      'assistant-message-1',
    )

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'Make the background darker',
        imageSources: [{ attachmentId: attachment.attachmentId }],
      }),
    )

    expect(result.imageOperation).toBe('edit')
    expect(result.body).toMatchObject({
      prompt: 'Make the background darker',
      images: [{ image_url: expect.stringMatching(/^data:image\/png;base64,/) }],
    })
    expect(result.userMessage.content).toContainEqual({
      type: 'input_image',
      attachment_id: attachment.attachmentId,
      detail: 'auto',
    })

    const row = dbClient.sqlite
      .prepare('select message_id as messageId from attachments where id = ?')
      .get(attachment.attachmentId) as { messageId: string | null } | undefined
    expect(row?.messageId).toBe('assistant-message-1')
  })

  it('binds an unbound explicit image source to the new user message', async () => {
    const { userId, modelId } = await createRunnableImageModel()
    const attachment = await createImageAttachment(userId)

    const result = assertPrepared(
      await prepare.prepareRun({
        userId,
        modelId,
        text: 'Use this uploaded image as a reference',
        imageSources: [{ attachmentId: attachment.attachmentId }],
      }),
    )

    const row = dbClient.sqlite
      .prepare('select message_id as messageId from attachments where id = ?')
      .get(attachment.attachmentId) as { messageId: string | null } | undefined
    expect(row?.messageId).toBe(result.userMessage.id)
  })

  it('rejects unsupported image edit input formats before calling upstream', async () => {
    const { userId, modelId } = await createRunnableImageModel()
    const attachment = await createImageAttachment(userId, 'image/gif', 'reference.gif')

    const result = await prepare.prepareRun({
      userId,
      modelId,
      text: 'Use this as a reference',
      attachments: [{ ...attachment, kind: 'image' }],
    })

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: 'unsupported_image_input',
    })
  })
})
