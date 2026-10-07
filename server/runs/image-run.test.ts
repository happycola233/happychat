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
  createResponseStream: vi.fn(),
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
  providerMocks.createResponseStream.mockReset()
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
  it('counts all returned images at a fixed unit price and keeps the frozen bill after edits', async () => {
    const fixture = await createFixture()
    fixture.model.pricing = {
      input: 100,
      output: 100,
      imageGeneration: { mode: 'per_image', price: 0.05 },
    }
    providerMocks.createImage.mockResolvedValue({
      data: [{ b64_json: 'iVBORw0KGgo=' }, { b64_json: 'iVBORw0KGgo=' }],
      usage: { input_tokens: 5000, output_tokens: 5000 },
    })
    await imageRun.runImageEngine({
      ...fixture,
      body: { prompt: 'synthetic fixture', size: '1024x1024', quality: 'high' },
      abortController: new AbortController(),
    })
    const log = dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, fixture.run.id))
      .get()!
    const message = dbClient.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, fixture.assistantMessage.id))
      .get()!
    expect(message.content.filter((part) => part.type === 'image_result')).toHaveLength(2)
    expect(log).toMatchObject({
      generatedImageCount: 2,
      costUsd: 0.1,
      costBreakdown: { chatUsd: 0, imageUsd: 0.1, imageCount: 2, imageStatus: 'complete' },
    })
    expect(message.costBreakdown).toEqual(log.costBreakdown)
    dbClient.db
      .update(schema.models)
      .set({ pricing: { imageGeneration: { mode: 'per_image', price: 9 } } })
      .where(eq(schema.models.id, fixture.model.id))
      .run()
    const stats = await import('../services/stats')
    expect((await stats.getOverview({ userId: fixture.user.id })).totals.costUsd).toBe(0.1)
    dbClient.db
      .delete(schema.conversations)
      .where(eq(schema.conversations.id, fixture.conversation.id))
      .run()
    expect((await stats.listUsageEvents({ userId: fixture.user.id })).items[0]?.costUsd).toBe(0.1)
  })

  it.each(['per_image', 'tokens'] as const)(
    'settles Responses tool images once with %s pricing',
    async (mode) => {
      const fixture = await createFixture()
      fixture.model.kind = 'responses'
      fixture.model.pricing = {
        input: 10,
        output: 50,
        imageGeneration:
          mode === 'per_image'
            ? { mode, price: 0.2, tiers: [{ size: '1024x1024', quality: 'high', price: 0.05 }] }
            : { mode, textInput: 5, imageInput: 8, imageOutput: 30 },
      }
      const item = {
        id: 'image-call',
        type: 'image_generation_call',
        result: 'iVBORw0KGgo=',
        status: 'completed',
        size: '1024x1024',
        quality: 'high',
        usage: {
          input_tokens: 1000,
          input_tokens_details: { text_tokens: 1000, image_tokens: 0 },
          output_tokens: 1000,
        },
      }
      providerMocks.createResponseStream.mockImplementation(async function* () {
        yield {
          type: 'response.image_generation_call.partial_image',
          data: {
            item_id: item.id,
            output_index: 0,
            partial_image_index: 0,
            partial_image_b64: 'iVBORw0KGgo=',
          },
        }
        yield { type: 'response.output_item.done', data: { output_index: 0, item } }
        yield {
          type: 'response.completed',
          data: {
            response: {
              id: 'response-test',
              status: 'completed',
              output: [{ id: item.id, type: item.type, result: item.result }],
              usage: { input_tokens: 1000, output_tokens: 1000, total_tokens: 2000 },
            },
          },
        }
      })
      const engine = await import('./engine')
      await engine.runEngine({
        ...fixture,
        body: { tools: [{ type: 'image_generation', model: 'image-test' }] },
        abortController: new AbortController(),
      })
      const log = dbClient.db
        .select()
        .from(schema.usageLogs)
        .where(eq(schema.usageLogs.runId, fixture.run.id))
        .get()!
      expect(log.generatedImageCount).toBe(1)
      expect(log.imageUsage).toHaveLength(1)
      expect(log.imageUsage?.[0]).toMatchObject({ size: '1024x1024', quality: 'high' })
      expect(log.costBreakdown?.chatUsd).toBeCloseTo(0.06)
      expect(log.costBreakdown?.imageUsd).toBeCloseTo(mode === 'per_image' ? 0.05 : 0.035)
      expect(log.costBreakdown?.imageStatus).toBe('complete')
    },
  )

  it('freezes a same-provider price reference before the stream and discloses missing tool tokens', async () => {
    const fixture = await createFixture()
    dbClient.db
      .update(schema.models)
      .set({ pricing: { imageGeneration: { mode: 'per_image', price: 0.1 } } })
      .where(eq(schema.models.id, fixture.model.id))
      .run()
    const pricingService = await import('../services/model-pricing')
    expect(
      pricingService.validImagePricingSource(
        { imagePricingModelId: fixture.model.id },
        'other-provider',
        'responses',
      ),
    ).toBe(false)
    fixture.model = {
      ...fixture.model,
      kind: 'responses',
      pricing: { imagePricingModelId: fixture.model.id },
    }
    providerMocks.createResponseStream.mockImplementation(async function* () {
      dbClient.db
        .update(schema.models)
        .set({ pricing: { imageGeneration: { mode: 'per_image', price: 9 } } })
        .where(eq(schema.models.id, fixture.model.id))
        .run()
      yield {
        type: 'response.completed',
        data: {
          response: {
            id: 'response-reference',
            status: 'completed',
            output: [{ id: 'image-ref', type: 'image_generation_call', result: 'iVBORw0KGgo=' }],
          },
        },
      }
    })
    const engine = await import('./engine')
    await engine.runEngine({ ...fixture, body: {}, abortController: new AbortController() })
    const log = dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, fixture.run.id))
      .get()!
    expect(log.costUsd).toBe(0.1)
    expect(log.pricingSnapshot).toEqual({ imageGeneration: { mode: 'per_image', price: 0.1 } })
    expect(log.imageUsage?.[0]?.imageOutputTokens).toBeNull()
  })
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
      generatedImageCount: 1,
      kind: 'chat',
      durationMs: expect.any(Number),
    })
    expect(events.at(-1)?.type).toBe('run.done')

    await dbClient.db
      .delete(schema.conversations)
      .where(eq(schema.conversations.id, fixture.conversation.id))
    const retainedUsage = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.id, usage!.id),
    })
    expect(retainedUsage).toMatchObject({ runId: null, generatedImageCount: 1, imageTokens: 6 })
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
      generatedImageCount: 0,
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
      generatedImageCount: 0,
    })
    expect(errors).toHaveLength(0)
  })
})
