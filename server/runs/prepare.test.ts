import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let prepare: typeof import('./prepare')
let conversationServices: typeof import('../services/conversations')
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

  return { userId, modelId }
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
  const storagePath = join(tmpDir, `${attachmentId}-${filename}`)
  const bytes = Buffer.from('image-bytes')
  writeFileSync(storagePath, bytes)

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
