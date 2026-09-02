import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let engine: typeof import('./engine')
let emitter: typeof import('./emitter')
let fixtureSequence = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-engine-reasoning-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-engine-reasoning'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  engine = await import('./engine')
  emitter = await import('./emitter')
  migration.runMigrations()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function createEngineFixture(input: unknown[] = []) {
  const sequence = fixtureSequence++
  const [user] = await dbClient.db
    .insert(schema.users)
    .values({ username: `engine-user-${sequence}`, passwordHash: 'hash' })
    .returning()
  const [provider] = await dbClient.db
    .insert(schema.providers)
    .values({
      name: `Engine provider ${sequence}`,
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
    })
    .returning()
  if (!user || !provider) throw new Error('Failed to create engine fixtures')
  const [model] = await dbClient.db
    .insert(schema.models)
    .values({
      providerId: provider.id,
      modelId: 'gpt-engine-test',
      displayName: `Engine model ${sequence}`,
      replayProviderContext: true,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: ['medium'],
      defaultEffort: 'medium',
    })
    .returning()
  if (!model) throw new Error('Failed to create engine model')
  const [conversation] = await dbClient.db
    .insert(schema.conversations)
    .values({ userId: user.id, title: `Existing title ${sequence}`, modelId: model.id })
    .returning()
  if (!conversation) throw new Error('Failed to create engine conversation')
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
  if (!assistantMessage) throw new Error('Failed to create engine assistant message')
  const [run] = await dbClient.db
    .insert(schema.runs)
    .values({
      conversationId: conversation.id,
      userId: user.id,
      assistantMessageId: assistantMessage.id,
      modelId: model.id,
      state: 'queued',
      requestParams: { reasoning_effort: 'medium' },
    })
    .returning()
  if (!run) throw new Error('Failed to create engine run')

  return {
    run,
    assistantMessage,
    conversation,
    model,
    provider,
    body: {
      model: model.modelId,
      input,
      store: false,
      reasoning: { effort: 'medium' },
      include: ['reasoning.encrypted_content'],
    },
    abortController: new AbortController(),
  }
}

describe('runEngine reasoning replay privacy and terminal handling', () => {
  it('routes commentary deltas into processSteps and starts the answer only for final output', async () => {
    const fixture = await createEngineFixture()
    const commentaryItem = {
      id: 'message-commentary',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'commentary' as const,
      content: [{ type: 'output_text', text: '正在核对资料。', annotations: [] }],
    }
    const finalItem = {
      id: 'message-final',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer' as const,
      content: [{ type: 'output_text', text: '最终回答。', annotations: [] }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'response.output_item.added', output_index: 0, item: commentaryItem },
          {
            type: 'response.output_text.delta',
            item_id: commentaryItem.id,
            output_index: 0,
            delta: '正在核对资料。',
          },
          { type: 'response.output_item.added', output_index: 1, item: finalItem },
          {
            type: 'response.output_text.delta',
            item_id: finalItem.id,
            output_index: 1,
            delta: '最终回答。',
          },
          {
            type: 'response.completed',
            response: {
              id: 'response-phase',
              status: 'completed',
              output: [commentaryItem, finalItem],
            },
          },
        ]),
      ),
    )

    await engine.runEngine(fixture)

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const storedEvents = await dbClient.db
      .select({ type: schema.runEvents.type })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))
    expect(storedMessage).toMatchObject({
      content: [{ type: 'output_text', text: '最终回答。', phase: 'final_answer' }],
      processSteps: [{ kind: 'commentary', text: '正在核对资料。' }],
    })
    expect(storedEvents.filter((event) => event.type === 'answer.started')).toHaveLength(1)
  })

  it('keeps streamed process steps when a compatibility gateway collapses terminal output', async () => {
    const fixture = await createEngineFixture()
    const firstReasoning = {
      id: 'reasoning-1',
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: '思考一' }],
      content: [],
    }
    const commentary = {
      id: 'commentary-1',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'commentary' as const,
      content: [{ type: 'output_text', text: '正在查资料。', annotations: [] }],
    }
    const search = {
      id: 'search-1',
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'open_page', url: 'https://example.com' },
    }
    const secondReasoning = {
      id: 'reasoning-2',
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: '思考二' }],
      content: [],
    }
    const finalAnswer = {
      id: 'final-1',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer' as const,
      content: [{ type: 'output_text', text: '最终回答。', annotations: [] }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'response.output_item.added', output_index: 0, item: firstReasoning },
          {
            type: 'response.reasoning_summary_text.delta',
            item_id: firstReasoning.id,
            output_index: 0,
            summary_index: 0,
            delta: '思考一',
          },
          { type: 'response.output_item.added', output_index: 1, item: commentary },
          {
            type: 'response.output_text.delta',
            item_id: commentary.id,
            output_index: 1,
            delta: '正在查资料。',
          },
          { type: 'response.output_item.added', output_index: 2, item: search },
          { type: 'response.output_item.done', output_index: 2, item: search },
          { type: 'response.output_item.added', output_index: 3, item: secondReasoning },
          {
            type: 'response.reasoning_summary_text.delta',
            item_id: secondReasoning.id,
            output_index: 3,
            summary_index: 0,
            delta: '思考二',
          },
          { type: 'response.output_item.added', output_index: 4, item: finalAnswer },
          {
            type: 'response.output_text.delta',
            item_id: finalAnswer.id,
            output_index: 4,
            delta: '最终回答。',
          },
          {
            type: 'response.completed',
            response: {
              id: 'collapsed-response',
              status: 'completed',
              // 真实兼容网关会把全部消息文本压到首条 commentary id，并丢掉其余 item。
              output: [
                firstReasoning,
                {
                  ...commentary,
                  phase: undefined,
                  content: [
                    { type: 'output_text', text: '正在查资料。最终回答。', annotations: [] },
                  ],
                },
              ],
            },
          },
        ]),
      ),
    )

    await engine.runEngine(fixture)

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    expect(storedMessage).toMatchObject({
      content: [{ type: 'output_text', text: '最终回答。', phase: 'final_answer' }],
      processSteps: [
        { kind: 'reasoning', text: '思考一' },
        { kind: 'commentary', text: '正在查资料。' },
        { kind: 'search', action: { type: 'open_page', url: 'https://example.com' } },
        { kind: 'reasoning', text: '思考二' },
      ],
    })
  })

  it('reclassifies raw-reasoning interim final_answer messages as commentary', async () => {
    const fixture = await createEngineFixture()
    const firstReasoning = {
      id: 'raw-reasoning-1',
      type: 'reasoning',
      status: 'completed',
      summary: [],
      content: [{ type: 'reasoning_text', text: '先分析' }],
    }
    const interimMessage = {
      id: 'raw-message-1',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer' as const,
      content: [{ type: 'output_text', text: '正在核对资料。', annotations: [] }],
    }
    const search = {
      id: 'raw-search-1',
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'search', queries: ['phase'] },
    }
    const secondReasoning = {
      id: 'raw-reasoning-2',
      type: 'reasoning',
      status: 'completed',
      summary: [],
      content: [{ type: 'reasoning_text', text: '再分析' }],
    }
    const finalMessage = {
      id: 'raw-message-2',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer' as const,
      content: [{ type: 'output_text', text: '最终回答。', annotations: [] }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'response.output_item.added', output_index: 0, item: firstReasoning },
          {
            type: 'response.reasoning_text.delta',
            item_id: firstReasoning.id,
            output_index: 0,
            content_index: 0,
            delta: '先分析',
          },
          { type: 'response.output_item.added', output_index: 1, item: interimMessage },
          {
            type: 'response.output_text.delta',
            item_id: interimMessage.id,
            output_index: 1,
            delta: '正在核对资料。',
          },
          {
            type: 'response.output_item.done',
            output_index: 1,
            item: { ...interimMessage, phase: 'commentary' },
          },
          { type: 'response.output_item.added', output_index: 2, item: search },
          { type: 'response.output_item.done', output_index: 2, item: search },
          { type: 'response.output_item.added', output_index: 3, item: secondReasoning },
          {
            type: 'response.reasoning_text.delta',
            item_id: secondReasoning.id,
            output_index: 3,
            content_index: 0,
            delta: '再分析',
          },
          { type: 'response.output_item.added', output_index: 4, item: finalMessage },
          {
            type: 'response.output_text.delta',
            item_id: finalMessage.id,
            output_index: 4,
            delta: '最终回答。',
          },
          { type: 'response.output_item.done', output_index: 4, item: finalMessage },
          {
            type: 'response.completed',
            response: {
              id: 'raw-response',
              status: 'completed',
              output: [
                firstReasoning,
                { ...interimMessage, phase: 'commentary' },
                search,
                secondReasoning,
                finalMessage,
              ],
            },
          },
        ]),
      ),
    )

    const emitted: Array<{ type: string; data: Record<string, unknown> }> = []
    const unsubscribe = emitter.runEmitter.subscribe(fixture.run.id, (event) => {
      emitted.push({ type: event.type, data: event.data })
    })
    await engine.runEngine(fixture)
    unsubscribe()

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    expect(storedMessage).toMatchObject({
      content: [{ type: 'output_text', text: '最终回答。', phase: 'final_answer' }],
      processSteps: [
        { kind: 'reasoning', text: '先分析' },
        { kind: 'commentary', text: '正在核对资料。' },
        { kind: 'search', action: { type: 'search', queries: ['phase'] } },
        { kind: 'reasoning', text: '再分析' },
      ],
    })
    expect(
      emitted.find((event) => event.type === 'response.output_item.reclassified')?.data,
    ).toMatchObject({
      itemId: interimMessage.id,
      phase: 'commentary',
      commentaryText: '正在核对资料。',
      answerText: '',
    })
    expect(
      emitted.filter(
        (event) =>
          event.type === 'response.output_text.delta' && event.data.item_id === interimMessage.id,
      ),
    ).toHaveLength(0)
    expect(emitted.filter((event) => event.type === 'answer.started')).toHaveLength(1)
  })

  it('keeps phase-less assistant output on the legacy final-answer path', async () => {
    const fixture = await createEngineFixture()
    const messageItem = {
      id: 'message-without-phase',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: '兼容回答', annotations: [] }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'response.output_item.added', output_index: 0, item: messageItem },
          {
            type: 'response.output_text.delta',
            item_id: messageItem.id,
            output_index: 0,
            delta: '兼容回答',
          },
          {
            type: 'response.completed',
            response: { id: 'response-legacy', status: 'completed', output: [messageItem] },
          },
        ]),
      ),
    )

    await engine.runEngine(fixture)

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    expect(storedMessage?.content).toEqual([{ type: 'output_text', text: '兼容回答' }])
    expect(storedMessage?.processSteps).toEqual([])
    expect(storedMessage?.content[0]).not.toHaveProperty('phase')
  })

  it('stores the raw terminal reasoning item privately and emits only sanitized calibrated events', async () => {
    const fixture = await createEngineFixture()
    const terminalReasoningItem = {
      id: 'rs-terminal',
      type: 'reasoning',
      content: [],
      encrypted_content: 'terminal-final-ciphertext',
      summary: [{ type: 'summary_text', text: '终态摘要' }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              ...terminalReasoningItem,
              encrypted_content: 'intermediate-added-ciphertext',
            },
          },
          { type: 'response.output_text.delta', delta: '流式草稿' },
          { type: 'response.output_item.done', output_index: 0, item: terminalReasoningItem },
          {
            type: 'response.completed',
            response: {
              id: 'response-terminal',
              status: 'completed',
              reasoning: { context: 'all_turns' },
              output: [
                terminalReasoningItem,
                {
                  id: 'message-terminal',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: '终态正文', annotations: [] }],
                },
              ],
              usage: {
                input_tokens: 12,
                output_tokens: 8,
                output_tokens_details: { reasoning_tokens: 3 },
                total_tokens: 20,
              },
            },
          },
        ]),
      ),
    )

    const emitted: Array<{ type: string; data: Record<string, unknown> }> = []
    const unsubscribe = emitter.runEmitter.subscribe(fixture.run.id, (event) => {
      emitted.push({ type: event.type, data: event.data })
    })
    await engine.runEngine(fixture)
    unsubscribe()

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const storedEvents = await dbClient.db
      .select({ type: schema.runEvents.type, data: schema.runEvents.data })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))
    const usageRows = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, fixture.run.id))
    const errorRows = await dbClient.db
      .select()
      .from(schema.errorLogs)
      .where(eq(schema.errorLogs.runId, fixture.run.id))

    expect(storedMessage).toMatchObject({
      status: 'complete',
      content: [{ type: 'output_text', text: '终态正文' }],
      processSteps: [{ kind: 'reasoning', text: '终态摘要' }],
      providerReplayContext: {
        version: 1,
        source: {
          providerId: fixture.provider.id,
          providerBaseUrl: fixture.provider.baseUrl,
          upstreamModelId: fixture.model.modelId,
        },
        reasoningContext: 'all_turns',
        items: [terminalReasoningItem],
      },
    })
    const serializedPublicEvents = JSON.stringify({ storedEvents, emitted })
    expect(serializedPublicEvents).not.toContain('terminal-final-ciphertext')
    expect(serializedPublicEvents).not.toContain('intermediate-added-ciphertext')
    expect(serializedPublicEvents).toContain('encrypted_content_omitted')
    expect(usageRows).toHaveLength(1)
    expect(JSON.stringify(usageRows)).not.toContain('terminal-final-ciphertext')
    expect(errorRows).toEqual([])

    const done = emitted.find((event) => event.type === 'run.done')
    expect(done?.data).toMatchObject({
      state: 'completed',
      text: '终态正文',
      processSteps: [{ kind: 'reasoning', text: '终态摘要' }],
      usage: { inputTokens: 12, outputTokens: 8, reasoningTokens: 3, totalTokens: 20 },
    })
    expect(done?.data).not.toHaveProperty('providerReplayContext')
  })

  it('streams and persists raw reasoning_text when the upstream returns no summary', async () => {
    const fixture = await createEngineFixture()
    const terminalReasoningItem = {
      id: 'rs-raw',
      type: 'reasoning',
      status: 'completed',
      summary: [],
      content: [{ type: 'reasoning_text', text: '终态原始推理' }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          {
            type: 'response.reasoning_text.delta',
            item_id: 'rs-raw',
            output_index: 0,
            content_index: 0,
            delta: '流式原始',
          },
          {
            type: 'response.reasoning_text.delta',
            item_id: 'rs-raw',
            output_index: 0,
            content_index: 0,
            delta: '推理',
          },
          { type: 'response.output_text.delta', delta: '流式正文' },
          {
            type: 'response.completed',
            response: {
              id: 'response-raw',
              status: 'completed',
              output: [
                terminalReasoningItem,
                {
                  id: 'message-raw',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: '终态正文', annotations: [] }],
                },
              ],
              usage: {
                input_tokens: 9,
                output_tokens: 17,
                output_tokens_details: { reasoning_tokens: 15 },
                total_tokens: 26,
              },
            },
          },
        ]),
      ),
    )

    const emitted: Array<{ type: string; data: Record<string, unknown> }> = []
    const unsubscribe = emitter.runEmitter.subscribe(fixture.run.id, (event) => {
      emitted.push({ type: event.type, data: event.data })
    })
    await engine.runEngine(fixture)
    unsubscribe()

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    expect(storedMessage).toMatchObject({
      status: 'complete',
      content: [{ type: 'output_text', text: '终态正文' }],
      processSteps: [{ kind: 'reasoning', text: '终态原始推理' }],
    })
    expect(emitted.filter((event) => event.type === 'response.reasoning_text.delta')).toHaveLength(
      2,
    )
    expect(emitted.find((event) => event.type === 'run.done')?.data).toMatchObject({
      state: 'completed',
      text: '终态正文',
      processSteps: [{ kind: 'reasoning', text: '终态原始推理' }],
    })
  })

  it.each([
    ['after deltas', [{ type: 'response.output_text.delta', delta: 'partial only' }]],
    ['without events', []],
  ])('fails when the upstream stream ends %s before a terminal event', async (_label, events) => {
    const fixture = await createEngineFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(events)),
    )

    await engine.runEngine(fixture)

    const storedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    expect(storedRun).toMatchObject({
      state: 'failed',
      errorMessage: '上游响应在终态事件前结束',
    })
    expect(storedMessage).toMatchObject({
      status: 'error',
      providerReplayContext: null,
    })
  })

  it.each([
    {
      label: 'completed + refusal',
      terminalEvent: {
        type: 'response.completed',
        response: {
          id: 'response-refusal',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
            },
          ],
          usage: { input_tokens: 13, output_tokens: 2, total_tokens: 15 },
        },
      },
      refusalEvent: {
        type: 'response.refusal.delta',
        delta: 'I cannot help with that.',
      },
      errorType: 'refusal',
      responseId: 'response-refusal',
      inputTokens: 13,
      totalTokens: 15,
    },
    {
      label: 'incomplete + content_filter',
      terminalEvent: {
        type: 'response.incomplete',
        response: {
          id: 'response-content-filter',
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '终态部分正文' }],
            },
          ],
          usage: { input_tokens: 17, output_tokens: 4, total_tokens: 21 },
        },
      },
      refusalEvent: null,
      errorType: 'content_filter',
      responseId: 'response-content-filter',
      inputTokens: 17,
      totalTokens: 21,
    },
  ])(
    '$label 作为失败终结，作废部分输出但保留 usage 与 response id',
    async ({ terminalEvent, refusalEvent, errorType, responseId, inputTokens, totalTokens }) => {
      const fixture = await createEngineFixture()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          sseResponse([
            { type: 'response.output_text.delta', delta: '流式部分正文' },
            ...(refusalEvent ? [refusalEvent] : []),
            terminalEvent,
          ]),
        ),
      )

      const emitted: Array<{ type: string; data: Record<string, unknown> }> = []
      const unsubscribe = emitter.runEmitter.subscribe(fixture.run.id, (event) => {
        emitted.push({ type: event.type, data: event.data })
      })
      await engine.runEngine(fixture)
      unsubscribe()

      const storedRun = await dbClient.db.query.runs.findFirst({
        where: eq(schema.runs.id, fixture.run.id),
      })
      const storedMessage = await dbClient.db.query.messages.findFirst({
        where: eq(schema.messages.id, fixture.assistantMessage.id),
      })
      const [usageLog] = await dbClient.db
        .select()
        .from(schema.usageLogs)
        .where(eq(schema.usageLogs.runId, fixture.run.id))
      const [errorLog] = await dbClient.db
        .select()
        .from(schema.errorLogs)
        .where(eq(schema.errorLogs.runId, fixture.run.id))

      expect(storedRun).toMatchObject({ state: 'failed', upstreamResponseId: responseId })
      expect(storedMessage).toMatchObject({
        status: 'error',
        content: [],
        inputTokens,
        totalTokens,
        providerReplayContext: null,
      })
      expect(usageLog).toMatchObject({
        inputTokens,
        totalTokens,
        success: false,
        errorType,
        outcome: 'failed',
        terminalReason: errorType,
      })
      expect(errorLog).toMatchObject({ errorType })
      expect(emitted.at(-1)).toMatchObject({
        type: 'run.error',
        data: { state: 'failed', discardPartialOutput: true },
      })
    },
  )

  it('普通输出上限截断保留部分正文、usage 与 response id', async () => {
    const fixture = await createEngineFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'response.output_text.delta', delta: '流式正文' },
          {
            type: 'response.incomplete',
            response: {
              id: 'response-max-output',
              status: 'incomplete',
              incomplete_details: { reason: 'max_output_tokens' },
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: '终态部分正文' }],
                },
              ],
              usage: { input_tokens: 19, output_tokens: 6, total_tokens: 25 },
            },
          },
        ]),
      ),
    )

    await engine.runEngine(fixture)

    const storedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const [usageLog] = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, fixture.run.id))

    expect(storedRun).toMatchObject({
      state: 'incomplete',
      incompleteReason: 'max_output_tokens',
      upstreamResponseId: 'response-max-output',
    })
    expect(storedMessage).toMatchObject({
      status: 'interrupted',
      content: [{ type: 'output_text', text: '终态部分正文' }],
      inputTokens: 19,
      totalTokens: 25,
    })
    expect(usageLog).toMatchObject({
      outcome: 'incomplete',
      terminalReason: 'max_output_tokens',
    })
  })

  it('独立 error 事件保留具体 code、使用稳定错误类型并脱敏消息', async () => {
    const opaqueContext = 'standalone-error-private-context'
    const fixture = await createEngineFixture([
      { type: 'reasoning', id: 'rs-error', encrypted_content: opaqueContext },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          {
            type: 'error',
            code: 'stream_generation_error',
            message: `failed to use encrypted_content ${opaqueContext}`,
          },
        ]),
      ),
    )

    await engine.runEngine(fixture)

    const storedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const usageLog = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.runId, fixture.run.id),
    })
    const errorLog = await dbClient.db.query.errorLogs.findFirst({
      where: eq(schema.errorLogs.runId, fixture.run.id),
    })
    const storedEvents = await dbClient.db
      .select({ type: schema.runEvents.type, data: schema.runEvents.data })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))

    expect(storedRun).toMatchObject({
      state: 'failed',
      errorCode: 'stream_generation_error',
      errorMessage: expect.stringContaining('[provider opaque content omitted]'),
    })
    expect(usageLog).toMatchObject({
      outcome: 'failed',
      terminalReason: 'stream_generation_error',
      errorType: 'response_error',
    })
    expect(errorLog).toMatchObject({
      errorType: 'response_error',
      code: 'stream_generation_error',
      message: expect.stringContaining('[provider opaque content omitted]'),
    })
    expect(storedEvents.at(-1)).toMatchObject({
      type: 'run.error',
      data: expect.objectContaining({ code: 'stream_generation_error' }),
    })
    expect(JSON.stringify(storedEvents)).not.toContain(opaqueContext)
  })

  it('response.failed 保留终态 usage、response id 与错误代码', async () => {
    const fixture = await createEngineFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          { type: 'response.output_text.delta', delta: '可诊断的部分正文' },
          {
            type: 'response.failed',
            response: {
              id: 'response-failed',
              status: 'failed',
              error: { code: 'server_error', message: 'upstream generation failed' },
              usage: { input_tokens: 23, output_tokens: 3, total_tokens: 26 },
            },
          },
        ]),
      ),
    )

    await engine.runEngine(fixture)

    const storedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const [usageLog] = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, fixture.run.id))
    const [errorLog] = await dbClient.db
      .select()
      .from(schema.errorLogs)
      .where(eq(schema.errorLogs.runId, fixture.run.id))

    expect(storedRun).toMatchObject({
      state: 'failed',
      upstreamResponseId: 'response-failed',
      errorMessage: 'upstream generation failed',
    })
    expect(storedMessage).toMatchObject({
      status: 'error',
      content: [{ type: 'output_text', text: '可诊断的部分正文' }],
      inputTokens: 23,
      totalTokens: 26,
    })
    expect(usageLog).toMatchObject({
      outcome: 'failed',
      terminalReason: 'server_error',
      errorType: 'server_error',
    })
    expect(errorLog).toMatchObject({
      errorType: 'server_error',
      code: 'server_error',
      message: 'upstream generation failed',
    })
  })

  it('retries an invalid history only before streaming and redacts echoed ciphertext on failure', async () => {
    const historyCiphertext = 'history-request-ciphertext'
    const fixture = await createEngineFixture([
      { type: 'reasoning', id: 'rs-history', encrypted_content: historyCiphertext },
      { type: 'message', role: 'assistant', content: [] },
    ])
    const attemptedBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        attemptedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return new Response(
          JSON.stringify({
            error: {
              type: 'invalid_request_error',
              code: 'invalid_reasoning_item',
              message: `The encrypted_content ${historyCiphertext} could not be decrypted.`,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await engine.runEngine(fixture)

    expect(attemptedBodies).toHaveLength(2)
    expect(JSON.stringify(attemptedBodies[0])).toContain(historyCiphertext)
    expect(JSON.stringify(attemptedBodies[1])).not.toContain(historyCiphertext)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid_reasoning_context'))

    const storedEvents = await dbClient.db
      .select({ data: schema.runEvents.data })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))
    const errorRows = await dbClient.db
      .select()
      .from(schema.errorLogs)
      .where(eq(schema.errorLogs.runId, fixture.run.id))
    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const serializedPersistentData = JSON.stringify({ storedEvents, errorRows, storedMessage })

    expect(serializedPersistentData).not.toContain(historyCiphertext)
    expect(serializedPersistentData).toContain('[provider opaque content omitted]')
    expect(storedMessage).toMatchObject({ status: 'error', providerReplayContext: null })
  })
})
