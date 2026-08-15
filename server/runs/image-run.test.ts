import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let imageRun: typeof import('./image-run')
let UpstreamError: typeof import('../provider/errors').UpstreamError
let fixtureSeq = 0

const providerMocks = vi.hoisted(() => ({
  createImage: vi.fn(),
  editImage: vi.fn(),
}))

vi.mock('../provider/client', () => ({
  providerClientFromRow: () => providerMocks,
}))

beforeAll(async () => {
  const testTempRoot = join(process.cwd(), '.tmp')
  mkdirSync(testTempRoot, { recursive: true })
  tmpDir = mkdtempSync(join(testTempRoot, 'happychat-image-run-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-image-run'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  imageRun = await import('./image-run')
  ;({ UpstreamError } = await import('../provider/errors'))
  migration.runMigrations()
})

beforeEach(() => {
  providerMocks.createImage.mockReset()
  providerMocks.editImage.mockReset()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

async function createFixture() {
  const suffix = fixtureSeq++
  const [user] = await dbClient.db
    .insert(schema.users)
    .values({ username: `image-user-${suffix}`, passwordHash: 'hash' })
    .returning()
  const [provider] = await dbClient.db
    .insert(schema.providers)
    .values({
      name: `Image provider ${suffix}`,
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
    })
    .returning()
  if (!user || !provider) throw new Error('Failed to create image fixtures')
  const [model] = await dbClient.db
    .insert(schema.models)
    .values({
      providerId: provider.id,
      modelId: `image-model-${suffix}`,
      displayName: 'Image model',
      kind: 'image',
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        image_generation: true,
        reasoning: false,
      },
      pricing: { image: 2 },
    })
    .returning()
  if (!model) throw new Error('Failed to create image model')
  const [conversation] = await dbClient.db
    .insert(schema.conversations)
    .values({ userId: user.id, modelId: model.id })
    .returning()
  if (!conversation) throw new Error('Failed to create image conversation')
  const [assistantMessage] = await dbClient.db
    .insert(schema.messages)
    .values({
      conversationId: conversation.id,
      role: 'assistant',
      status: 'streaming',
      modelId: model.id,
      content: [],
    })
    .returning()
  if (!assistantMessage) throw new Error('Failed to create image assistant message')
  const [run] = await dbClient.db
    .insert(schema.runs)
    .values({
      conversationId: conversation.id,
      userId: user.id,
      assistantMessageId: assistantMessage.id,
      modelId: model.id,
      state: 'queued',
    })
    .returning()
  if (!run) throw new Error('Failed to create image run')
  return { user, provider, model, conversation, assistantMessage, run }
}

describe('runImageEngine audit outcome', () => {
  it('settles successful image state and usage atomically', async () => {
    const fixture = await createFixture()
    providerMocks.createImage.mockResolvedValue({
      // PNG 文件签名已经足够覆盖存储路径；附件读取并不解码图片像素。
      data: [{ b64_json: 'iVBORw0KGgo=', revised_prompt: 'a small cat' }],
      output_format: 'png',
      usage: {
        input_tokens: 4,
        output_tokens: 6,
        total_tokens: 10,
        output_tokens_details: { image_tokens: 6 },
      },
    })

    await imageRun.runImageEngine({
      ...fixture,
      body: { prompt: 'cat' },
      abortController: new AbortController(),
    })

    const usage = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.runId, fixture.run.id),
    })
    const persistedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const events = await dbClient.db
      .select({ type: schema.runEvents.type })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))
    expect(persistedRun?.state).toBe('completed')
    expect(usage).toMatchObject({
      outcome: 'completed',
      terminalReason: null,
      success: true,
      imageTokens: 6,
    })
    expect(events.at(-1)?.type).toBe('run.done')
  })

  it('keeps upstream failure details in both usage and error audit rows', async () => {
    const fixture = await createFixture()
    providerMocks.createImage.mockRejectedValue(
      new UpstreamError({
        message: 'rate limited',
        status: 429,
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
      }),
    )

    await imageRun.runImageEngine({
      ...fixture,
      body: { prompt: 'cat' },
      abortController: new AbortController(),
    })

    const usage = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.runId, fixture.run.id),
    })
    const persistedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const error = await dbClient.db.query.errorLogs.findFirst({
      where: eq(schema.errorLogs.runId, fixture.run.id),
    })
    const terminalEvent = await dbClient.db.query.runEvents.findFirst({
      where: eq(schema.runEvents.runId, fixture.run.id),
      orderBy: (events, { desc }) => desc(events.sequenceNumber),
    })
    expect(persistedRun).toMatchObject({ state: 'failed', errorCode: 'rate_limit_exceeded' })
    expect(usage).toMatchObject({
      outcome: 'failed',
      terminalReason: 'rate_limit_exceeded',
      success: false,
      errorType: 'rate_limit_error',
    })
    expect(error).toMatchObject({
      errorType: 'rate_limit_error',
      code: 'rate_limit_exceeded',
      httpStatus: 429,
    })
    expect(terminalEvent).toMatchObject({
      type: 'run.error',
      data: expect.objectContaining({ code: 'rate_limit_exceeded' }),
    })
  })

  it('records user cancellation separately without creating an upstream error row', async () => {
    const fixture = await createFixture()
    const abortController = new AbortController()
    abortController.abort()
    providerMocks.createImage.mockRejectedValue(new Error('aborted'))

    await imageRun.runImageEngine({
      ...fixture,
      body: { prompt: 'cat' },
      abortController,
    })

    const usage = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.runId, fixture.run.id),
    })
    const errors = await dbClient.db
      .select()
      .from(schema.errorLogs)
      .where(eq(schema.errorLogs.runId, fixture.run.id))
    expect(usage).toMatchObject({
      outcome: 'canceled',
      terminalReason: 'user_cancelled',
      success: true,
      errorType: null,
    })
    expect(errors).toHaveLength(0)
  })
})
