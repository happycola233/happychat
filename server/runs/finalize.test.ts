import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ContentPart } from '@shared/types/domain'
import type { FinalizeArgs } from './finalize'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let finalize: typeof import('./finalize')

beforeAll(async () => {
  const testTempRoot = join(process.cwd(), '.tmp')
  mkdirSync(testTempRoot, { recursive: true })
  tmpDir = mkdtempSync(join(testTempRoot, 'happychat-finalize-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-finalize'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  finalize = await import('./finalize')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

describe('finalizeRun terminal snapshots', () => {
  it('stores timing and private replay context without exposing it through run.done', async () => {
    const [user] = await dbClient.db
      .insert(schema.users)
      .values({ username: 'finalize-user', passwordHash: 'hash' })
      .returning()
    const [provider] = await dbClient.db
      .insert(schema.providers)
      .values({
        name: 'Finalize provider',
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
      })
      .returning()
    if (!user || !provider) throw new Error('Failed to create finalize fixtures')

    const [model] = await dbClient.db
      .insert(schema.models)
      .values({
        providerId: provider.id,
        modelId: 'finalize-model',
        displayName: 'Finalize model',
        capabilities: {
          vision: false,
          file_input: false,
          web_search: false,
          x_search: false,
          image_generation: false,
          reasoning: true,
        },
        allowedEfforts: [{ value: 'high', description: '深度思考' }],
        defaultEffort: 'high',
        pricing: { input: 2, cachedInput: 0.2, output: 8 },
      })
      .returning()
    if (!model) throw new Error('Failed to create finalize model')

    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id, title: '已有标题', modelId: model.id })
      .returning()
    if (!conversation) throw new Error('Failed to create finalize conversation')
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
    if (!assistantMessage) throw new Error('Failed to create assistant message')

    const startedAt = new Date(Date.UTC(2026, 6, 17, 9, 0, 0))
    const [run] = await dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: user.id,
        assistantMessageId: assistantMessage.id,
        modelId: model.id,
        state: 'running',
        requestParams: { reasoning_effort: 'high' },
        startedAt,
      })
      .returning()
    if (!run) throw new Error('Failed to create finalize run')
    await dbClient.db.insert(schema.runEvents).values([
      {
        runId: run.id,
        sequenceNumber: 0,
        type: 'response.created',
        data: {},
        createdAt: new Date(startedAt.getTime() + 1_000),
      },
      {
        runId: run.id,
        sequenceNumber: 1,
        type: 'answer.started',
        data: { delta: '回答' },
        createdAt: new Date(startedAt.getTime() + 4_500),
      },
      {
        runId: run.id,
        sequenceNumber: 2,
        type: 'response.output_text.delta',
        data: { delta: '回答' },
        createdAt: new Date(startedAt.getTime() + 4_800),
      },
    ])

    const providerReplayContext = {
      version: 1 as const,
      source: {
        providerId: provider.id,
        providerBaseUrl: provider.baseUrl,
        upstreamModelId: model.modelId,
      },
      reasoningContext: 'all_turns',
      items: [{ type: 'reasoning', encrypted_content: 'opaque-finalize-ciphertext' }],
    }
    const processSteps = [
      { kind: 'reasoning' as const, text: '思考摘要' },
      {
        kind: 'search' as const,
        action: { type: 'search' as const, queries: ['react 19 发布时间'] },
      },
      {
        kind: 'search' as const,
        action: { type: 'open_page' as const, url: 'https://react.dev/blog' },
      },
    ]
    const emittedEvents: Array<{ type: string; data: Record<string, unknown> }> = []
    const completedArgs = {
      run,
      assistantMessage,
      conversation,
      model,
      provider,
      state: 'completed',
      text: '回答',
      processSteps,
      annotations: [],
      usage: {
        inputTokens: 10,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        outputTokens: 5,
        reasoningTokens: 2,
        totalTokens: 15,
      },
      incompleteReason: null,
      errorMessage: null,
      upstreamResponseId: null,
      providerReplayContext,
      startedAt,
      upstreamResponseLatencyMs: 1_250,
      persistEmit: (type, data) => {
        emittedEvents.push({ type, data })
        return emittedEvents.length - 1
      },
    } satisfies Parameters<typeof finalize.finalizeRun>[0]
    await finalize.finalizeRun(completedArgs)

    const persistedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, run.id),
    })
    const persistedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, assistantMessage.id),
    })
    const persistedUsage = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.runId, run.id),
    })
    expect(persistedRun?.finishedAt).toBeInstanceOf(Date)
    expect(persistedMessage).toMatchObject({
      status: 'complete',
      providerReplayContext,
      processSteps,
      reasoningDurationMs: 3_500,
      generationDurationMs: persistedRun!.finishedAt!.getTime() - startedAt.getTime(),
    })
    expect(persistedMessage?.costUsd).toBeCloseTo(0.00006, 10)
    expect(persistedUsage).toMatchObject({
      pricingSnapshot: model.pricing,
      outcome: 'completed',
      terminalReason: null,
      success: true,
      reasoningEffort: 'high',
      durationMs: persistedRun!.finishedAt!.getTime() - startedAt.getTime(),
      upstreamResponseLatencyMs: 1_250,
      firstTokenLatencyMs: 4_800,
      generatedImageCount: 0,
    })
    expect(persistedUsage?.quotaAt?.getTime()).toBe(run.createdAt.getTime())
    expect(emittedEvents.map((event) => event.type)).toEqual(['run.done'])
    expect(emittedEvents[0]?.data).toMatchObject({ processSteps })
    expect(emittedEvents[0]?.data).not.toHaveProperty('providerReplayContext')
    expect(JSON.stringify(emittedEvents)).not.toContain('opaque-finalize-ciphertext')

    // 同一个 run 的第二个终结者 CAS 不命中，不得重复写审计或发终态事件。
    await finalize.finalizeRun(completedArgs)
    const completedUsageRows = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, run.id))
    expect(completedUsageRows).toHaveLength(1)
    expect(emittedEvents.map((event) => event.type)).toEqual(['run.done'])

    const [failedMessage] = await dbClient.db
      .insert(schema.messages)
      .values({
        conversationId: conversation.id,
        role: 'assistant',
        status: 'streaming',
        modelId: model.id,
        content: [],
      })
      .returning()
    if (!failedMessage) throw new Error('Failed to create failed assistant fixture')
    const [failedRun] = await dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: user.id,
        assistantMessageId: failedMessage.id,
        modelId: model.id,
        state: 'running',
        requestParams: { reasoning_effort: 'high' },
        startedAt,
      })
      .returning()
    if (!failedRun) throw new Error('Failed to create failed run fixture')

    const failedEvents: Array<{ type: string; data: Record<string, unknown> }> = []
    await finalize.finalizeRun({
      run: failedRun,
      assistantMessage: failedMessage,
      conversation,
      model,
      provider,
      state: 'failed',
      text: '',
      processSteps: [],
      annotations: [],
      usage: {
        inputTokens: 0,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
      incompleteReason: null,
      errorMessage: 'upstream failed',
      errorType: 'refusal',
      errorCode: 'request_rejected',
      httpStatus: 400,
      discardPartialOutput: true,
      upstreamResponseId: null,
      providerReplayContext,
      startedAt,
      upstreamResponseLatencyMs: 880,
      persistEmit: (type, data) => {
        failedEvents.push({ type, data })
        return 0
      },
    })

    const persistedFailedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, failedMessage.id),
    })
    const persistedFailedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, failedRun.id),
    })
    const persistedFailedUsage = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.runId, failedRun.id),
    })
    const persistedError = await dbClient.db.query.errorLogs.findFirst({
      where: eq(schema.errorLogs.runId, failedRun.id),
    })
    expect(persistedFailedMessage?.providerReplayContext).toBeNull()
    expect(persistedFailedMessage?.processSteps).toEqual([])
    // 新写入不再触碰旧列。
    expect(persistedFailedMessage?.searchActions).toBeNull()
    expect(persistedFailedRun?.errorCode).toBe('request_rejected')
    expect(persistedFailedUsage).toMatchObject({
      outcome: 'failed',
      terminalReason: 'refusal',
      success: false,
      errorType: 'refusal',
    })
    expect(persistedError).toMatchObject({
      errorType: 'refusal',
      code: 'request_rejected',
      httpStatus: 400,
      message: 'upstream failed',
    })
    expect(failedEvents).toEqual([
      {
        type: 'run.error',
        data: {
          state: 'failed',
          message: 'upstream failed',
          code: 'request_rejected',
          discardPartialOutput: true,
        },
      },
    ])

    for (const terminal of [
      {
        state: 'incomplete',
        incompleteReason: 'max_output_tokens',
        terminalReason: 'max_output_tokens',
        eventType: 'run.done',
      },
      {
        state: 'canceled',
        incompleteReason: null,
        terminalReason: 'user_cancelled',
        eventType: 'run.canceled',
      },
    ] as const) {
      const [terminalMessage] = await dbClient.db
        .insert(schema.messages)
        .values({
          conversationId: conversation.id,
          role: 'assistant',
          status: 'streaming',
          modelId: model.id,
          content: [],
        })
        .returning()
      if (!terminalMessage) throw new Error('Failed to create terminal assistant fixture')
      const [terminalRun] = await dbClient.db
        .insert(schema.runs)
        .values({
          conversationId: conversation.id,
          userId: user.id,
          assistantMessageId: terminalMessage.id,
          modelId: model.id,
          state: 'running',
          requestParams: { reasoning_effort: 'high' },
          startedAt,
        })
        .returning()
      if (!terminalRun) throw new Error('Failed to create terminal run fixture')

      const terminalEvents: string[] = []
      await finalize.finalizeRun({
        run: terminalRun,
        assistantMessage: terminalMessage,
        conversation,
        model,
        provider,
        state: terminal.state,
        text: terminal.state === 'incomplete' ? '部分回答' : '',
        processSteps: [],
        annotations: [],
        usage: {
          inputTokens: 10,
          cacheWriteTokens: 0,
          cachedTokens: 0,
          outputTokens: 2,
          reasoningTokens: 0,
          totalTokens: 12,
        },
        incompleteReason: terminal.incompleteReason,
        errorMessage: null,
        upstreamResponseId: null,
        startedAt,
        upstreamResponseLatencyMs: 640,
        persistEmit: (type) => {
          terminalEvents.push(type)
          return 0
        },
      })

      const terminalUsage = await dbClient.db.query.usageLogs.findFirst({
        where: eq(schema.usageLogs.runId, terminalRun.id),
      })
      expect(terminalUsage).toMatchObject({
        outcome: terminal.state,
        terminalReason: terminal.terminalReason,
        // 保留既有额度口径：截断与用户停止仍不等同于上游失败。
        success: true,
      })
      expect(terminalEvents).toEqual([terminal.eventType])
    }

    const [rollbackMessage] = await dbClient.db
      .insert(schema.messages)
      .values({
        conversationId: conversation.id,
        role: 'assistant',
        status: 'streaming',
        modelId: model.id,
        content: [],
      })
      .returning()
    if (!rollbackMessage) throw new Error('Failed to create rollback message fixture')
    const [rollbackRun] = await dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: user.id,
        assistantMessageId: rollbackMessage.id,
        modelId: model.id,
        state: 'running',
        startedAt,
      })
      .returning()
    if (!rollbackRun) throw new Error('Failed to create rollback run fixture')
    const rollbackEvents: string[] = []

    await expect(
      finalize.finalizeRun({
        ...completedArgs,
        run: rollbackRun,
        assistantMessage: rollbackMessage,
        // usage_logs.provider_id 的外键失败，用来验证前面的 run/message 更新会一起回滚。
        provider: { ...provider, id: 'missing-provider' },
        persistEmit: (type) => {
          rollbackEvents.push(type)
          return 0
        },
      }),
    ).rejects.toThrow()

    const rolledBackRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, rollbackRun.id),
    })
    const rolledBackMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, rollbackMessage.id),
    })
    const rolledBackUsage = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, rollbackRun.id))
    expect(rolledBackRun?.state).toBe('running')
    expect(rolledBackMessage?.status).toBe('streaming')
    expect(rolledBackUsage).toHaveLength(0)
    expect(rollbackEvents).toHaveLength(0)
  })
})

describe('finalizeRun generated image audit', () => {
  const cases: Array<{
    name: string
    state: FinalizeArgs['state']
    content: ContentPart[]
    imageCapability: boolean
    expectedCount: number
    discardPartialOutput?: boolean
  }> = [
    {
      name: 'counts distinct final images from a model-routed response, excluding input images',
      state: 'completed',
      content: [
        { type: 'output_text', text: '测试图片结果' },
        { type: 'input_image', attachment_id: 'input-image' },
        { type: 'image_result', attachment_id: 'final-a' },
        { type: 'image_result', attachment_id: 'final-b' },
        { type: 'image_result', attachment_id: 'final-a' },
      ],
      imageCapability: false,
      expectedCount: 2,
    },
    {
      name: 'does not infer a generated image from model capability or partial events',
      state: 'completed',
      content: [{ type: 'output_text', text: '测试文本结果' }],
      imageCapability: true,
      expectedCount: 0,
    },
    {
      name: 'counts a final image retained when the remaining generation is canceled',
      state: 'canceled',
      content: [{ type: 'image_result', attachment_id: 'retained-final' }],
      imageCapability: true,
      expectedCount: 1,
    },
    {
      name: 'does not count discarded image output after a refusal',
      state: 'failed',
      content: [],
      imageCapability: true,
      expectedCount: 0,
      discardPartialOutput: true,
    },
  ]

  it.each(cases)('$name', async (testCase) => {
    const suffix = cases.indexOf(testCase)
    const user = dbClient.db
      .insert(schema.users)
      .values({
        username: `generated-image-audit-${suffix}`,
        passwordHash: 'hash',
      })
      .returning()
      .get()
    const provider = dbClient.db
      .insert(schema.providers)
      .values({
        name: `Generated image audit ${suffix}`,
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
      })
      .returning()
      .get()
    const model = dbClient.db
      .insert(schema.models)
      .values({
        providerId: provider.id,
        modelId: `routed-model-${suffix}`,
        displayName: 'Routed model',
        kind: 'responses',
        capabilities: {
          vision: true,
          file_input: false,
          web_search: false,
          x_search: false,
          reasoning: false,
          image_generation: testCase.imageCapability,
        },
        pricing: { input: 2, output: 8, image: 99 },
      })
      .returning()
      .get()
    const conversation = dbClient.db
      .insert(schema.conversations)
      .values({
        userId: user.id,
        modelId: model.id,
        title: '生成图审计测试',
      })
      .returning()
      .get()
    const assistantMessage = dbClient.db
      .insert(schema.messages)
      .values({
        conversationId: conversation.id,
        role: 'assistant',
        status: 'streaming',
        modelId: model.id,
        content: [],
      })
      .returning()
      .get()
    const startedAt = new Date()
    const run = dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: user.id,
        assistantMessageId: assistantMessage.id,
        modelId: model.id,
        state: 'running',
        startedAt,
      })
      .returning()
      .get()
    dbClient.db
      .insert(schema.runEvents)
      .values({
        runId: run.id,
        sequenceNumber: 0,
        type: 'image.generation.partial',
        data: { attachmentId: 'partial-image', partialIndex: 0 },
      })
      .run()

    await finalize.finalizeRun({
      run,
      assistantMessage,
      conversation,
      model,
      provider,
      state: testCase.state,
      text: '',
      content: testCase.content,
      processSteps: [],
      annotations: [],
      usage: {
        inputTokens: 10,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
        totalTokens: 15,
      },
      incompleteReason: null,
      errorMessage: testCase.state === 'failed' ? '测试拒绝' : null,
      errorType: testCase.state === 'failed' ? 'refusal' : null,
      discardPartialOutput: testCase.discardPartialOutput,
      upstreamResponseId: null,
      startedAt,
      upstreamResponseLatencyMs: 100,
      persistEmit: () => 1,
    })

    const usage = dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, run.id))
      .get()!
    const message = dbClient.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, assistantMessage.id))
      .get()!
    expect(usage).toMatchObject({
      generatedImageCount: testCase.expectedCount,
      kind: 'chat',
      imageTokens: 0,
      inputTokens: 10,
      outputTokens: 5,
    })
    expect(message.content).toEqual(testCase.content)
    expect(message.costUsd).toBeCloseTo(0.00006, 10)

    // 删除会话会级联清理 run / message / partial 事件，图片数量仍是请求自己的审计快照。
    dbClient.db
      .delete(schema.conversations)
      .where(eq(schema.conversations.id, conversation.id))
      .run()
    expect(
      dbClient.db.select().from(schema.runs).where(eq(schema.runs.id, run.id)).get(),
    ).toBeUndefined()
    expect(
      dbClient.db.select().from(schema.usageLogs).where(eq(schema.usageLogs.id, usage.id)).get(),
    ).toMatchObject({
      runId: null,
      generatedImageCount: testCase.expectedCount,
      kind: 'chat',
    })
  })
})
