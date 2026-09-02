import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let temporaryDirectory: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let anthropicEngine: typeof import('./anthropic-engine')
let fixtureSequence = 0

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'happychat-anthropic-engine-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-anthropic-engine'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  anthropicEngine = await import('./anthropic-engine')
  migration.runMigrations()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

function sseResponse(events: Array<Record<string, unknown>>): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

async function createFixture() {
  fixtureSequence += 1
  const [user] = await dbClient.db
    .insert(schema.users)
    .values({ username: `anthropic-engine-user-${fixtureSequence}`, passwordHash: 'hash' })
    .returning()
  const [provider] = await dbClient.db
    .insert(schema.providers)
    .values({
      name: 'Anthropic provider',
      baseUrl: 'https://example.test',
      apiKey: 'test-key',
      protocol: 'anthropic',
    })
    .returning()
  if (!user || !provider) throw new Error('Failed to create provider fixtures')

  const [model] = await dbClient.db
    .insert(schema.models)
    .values({
      providerId: provider.id,
      modelId: 'claude-sonnet-5',
      displayName: 'Claude Sonnet 5',
      kind: 'anthropic',
      replayProviderContext: true,
      capabilities: {
        vision: true,
        file_input: true,
        web_search: true,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: ['high'],
      defaultEffort: 'high',
    })
    .returning()
  if (!model) throw new Error('Failed to create model fixture')

  const [conversation] = await dbClient.db
    .insert(schema.conversations)
    .values({ userId: user.id, title: 'Existing title', modelId: model.id })
    .returning()
  if (!conversation) throw new Error('Failed to create conversation fixture')

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
  if (!assistantMessage) throw new Error('Failed to create assistant fixture')

  const [run] = await dbClient.db
    .insert(schema.runs)
    .values({
      conversationId: conversation.id,
      userId: user.id,
      assistantMessageId: assistantMessage.id,
      modelId: model.id,
      state: 'queued',
      requestParams: { reasoning_effort: 'high', web_search: true },
    })
    .returning()
  if (!run) throw new Error('Failed to create run fixture')

  return {
    run,
    assistantMessage,
    conversation,
    model,
    provider,
    body: {
      model: model.modelId,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
      max_tokens: 1024,
      thinking: { type: 'adaptive', display: 'summarized' },
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      stream: true,
    },
    abortController: new AbortController(),
  }
}

describe('runAnthropicEngine', () => {
  it('续跑 pause_turn，累计 usage，并只在私有信封保存 opaque blocks', async () => {
    const fixture = await createFixture()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'message_start',
            message: {
              id: 'msg_pause',
              usage: { input_tokens: 10, cache_creation_input_tokens: 2, output_tokens: 1 },
            },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'server_tool_use',
              id: 'srv_search',
              name: 'web_search',
              input: {},
            },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"query":"Claude 5"}' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'pause_turn' },
            usage: { output_tokens: 5 },
          },
          { type: 'message_stop' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'message_start',
            message: {
              id: 'msg_final',
              usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 1 },
            },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'web_search_tool_result',
              tool_use_id: 'srv_search',
              content: [
                {
                  type: 'web_search_result',
                  url: 'https://example.com/source',
                  title: 'Source',
                  encrypted_content: 'opaque-search-result',
                },
              ],
            },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'thinking_delta', thinking: '推理摘要' },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'signature_delta', signature: 'opaque-thinking-signature' },
          },
          { type: 'content_block_stop', index: 1 },
          {
            type: 'content_block_start',
            index: 2,
            content_block: { type: 'text', text: '' },
          },
          {
            type: 'content_block_delta',
            index: 2,
            delta: { type: 'text_delta', text: '答案' },
          },
          {
            type: 'content_block_delta',
            index: 2,
            delta: {
              type: 'citations_delta',
              citation: {
                type: 'web_search_result_location',
                url: 'https://example.com/source',
                title: 'Source',
                encrypted_index: 'opaque-citation-index',
              },
            },
          },
          { type: 'content_block_stop', index: 2 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 8 } },
          },
          { type: 'message_stop' },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    await anthropicEngine.runAnthropicEngine(fixture)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: unknown[]
    }
    expect(secondRequest.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'server_tool_use',
          id: 'srv_search',
          name: 'web_search',
          input: { query: 'Claude 5' },
        },
      ],
    })

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    expect(storedMessage).toMatchObject({
      status: 'complete',
      processSteps: [
        { kind: 'search', action: { type: 'search', queries: ['Claude 5'] } },
        { kind: 'reasoning', text: '推理摘要' },
      ],
      annotations: [
        {
          type: 'url_citation',
          url: 'https://example.com/source',
          title: 'Source',
          start_index: 0,
          end_index: 2,
        },
      ],
      inputTokens: 27,
      cacheWriteTokens: 2,
      cachedTokens: 3,
      outputTokens: 25,
      reasoningTokens: 8,
      totalTokens: 52,
    })
    expect(storedMessage?.content).toEqual([{ type: 'output_text', text: '答案' }])
    expect(storedMessage?.providerReplayContext).toMatchObject({
      protocol: 'anthropic_messages',
      content: [
        { type: 'server_tool_use', input: { query: 'Claude 5' } },
        {
          type: 'web_search_tool_result',
          content: [{ encrypted_content: 'opaque-search-result' }],
        },
        { type: 'thinking', signature: 'opaque-thinking-signature' },
        { type: 'text', citations: [{ encrypted_index: 'opaque-citation-index' }] },
      ],
    })

    const browserEvents = await dbClient.db
      .select({ type: schema.runEvents.type, data: schema.runEvents.data })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))
    const serializedBrowserEvents = JSON.stringify(browserEvents)
    expect(serializedBrowserEvents).not.toContain('opaque-search-result')
    expect(serializedBrowserEvents).not.toContain('opaque-thinking-signature')
    expect(serializedBrowserEvents).not.toContain('opaque-citation-index')
    expect(browserEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'response.web_search_call.searching',
        'response.web_search_call.completed',
        'response.reasoning_summary_text.delta',
        'response.output_text.annotation.added',
        'run.done',
      ]),
    )
  })

  it('refusal 作为失败终结，丢弃全部部分输出但保留 usage', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        sseResponse([
          {
            type: 'message_start',
            message: { id: 'msg_refusal', usage: { input_tokens: 7, output_tokens: 0 } },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: '作废思考' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'discarded-signature' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: {
              type: 'server_tool_use',
              id: 'srv_refusal',
              name: 'web_search',
              input: {},
            },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"query":"discarded query"}' },
          },
          { type: 'content_block_stop', index: 1 },
          {
            type: 'content_block_start',
            index: 2,
            content_block: {
              type: 'web_search_tool_result',
              tool_use_id: 'srv_refusal',
              content: [],
            },
          },
          { type: 'content_block_stop', index: 2 },
          {
            type: 'content_block_start',
            index: 3,
            content_block: { type: 'text', text: '' },
          },
          {
            type: 'content_block_delta',
            index: 3,
            delta: { type: 'text_delta', text: '作废正文' },
          },
          {
            type: 'content_block_delta',
            index: 3,
            delta: {
              type: 'citations_delta',
              citation: {
                type: 'web_search_result_location',
                url: 'https://example.com/discarded',
                title: 'Discarded',
              },
            },
          },
          { type: 'content_block_stop', index: 3 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'refusal' },
            usage: { output_tokens: 9, output_tokens_details: { thinking_tokens: 3 } },
          },
          { type: 'message_stop' },
        ]),
      ),
    )

    await anthropicEngine.runAnthropicEngine(fixture)

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const storedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const usageLog = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.runId, fixture.run.id),
    })
    const errorLog = await dbClient.db.query.errorLogs.findFirst({
      where: eq(schema.errorLogs.runId, fixture.run.id),
    })
    const runError = await dbClient.db.query.runEvents.findFirst({
      where: eq(schema.runEvents.runId, fixture.run.id),
      orderBy: (events, { desc }) => [desc(events.sequenceNumber)],
    })

    expect(storedMessage).toMatchObject({
      status: 'error',
      content: [],
      processSteps: [],
      annotations: null,
      providerReplayContext: null,
      inputTokens: 7,
      outputTokens: 9,
      reasoningTokens: 3,
      totalTokens: 16,
      errorMessage: '模型拒绝了此请求，请调整内容后重试。',
    })
    expect(storedRun).toMatchObject({
      state: 'failed',
      incompleteReason: null,
      errorMessage: '模型拒绝了此请求，请调整内容后重试。',
    })
    expect(usageLog).toMatchObject({ success: false, errorType: 'refusal' })
    expect(errorLog).toMatchObject({ errorType: 'refusal', httpStatus: null })
    expect(runError).toMatchObject({
      type: 'run.error',
      data: {
        state: 'failed',
        message: '模型拒绝了此请求，请调整内容后重试。',
        discardPartialOutput: true,
      },
    })
  })

  it('tool_use 在无客户端工具执行器时作为明确失败', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        sseResponse([
          {
            type: 'message_start',
            message: { id: 'msg_tool_use', usage: { input_tokens: 4, output_tokens: 0 } },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tool_1', name: 'get_weather', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"city":"Shanghai"}' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 6 },
          },
          { type: 'message_stop' },
        ]),
      ),
    )

    await anthropicEngine.runAnthropicEngine(fixture)

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const storedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const usageLog = await dbClient.db.query.usageLogs.findFirst({
      where: eq(schema.usageLogs.runId, fixture.run.id),
    })
    const errorLog = await dbClient.db.query.errorLogs.findFirst({
      where: eq(schema.errorLogs.runId, fixture.run.id),
    })
    const eventTypes = await dbClient.db
      .select({ type: schema.runEvents.type, data: schema.runEvents.data })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))

    expect(storedMessage).toMatchObject({
      status: 'error',
      providerReplayContext: null,
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
      errorMessage: '模型请求了本站不支持的客户端工具，生成已停止。',
    })
    expect(storedRun).toMatchObject({
      state: 'failed',
      incompleteReason: null,
      errorMessage: '模型请求了本站不支持的客户端工具，生成已停止。',
    })
    expect(usageLog).toMatchObject({ success: false, errorType: 'tool_use' })
    expect(errorLog).toMatchObject({ errorType: 'tool_use' })
    expect(eventTypes.at(-1)).toMatchObject({
      type: 'run.error',
      data: {
        state: 'failed',
        message: '模型请求了本站不支持的客户端工具，生成已停止。',
      },
    })
    expect(eventTypes.at(-1)?.data).not.toHaveProperty('discardPartialOutput')
  })

  it('仅对含未解决客户端或服务端工具调用的截断响应丢弃 replay', async () => {
    const resolvedFixture = await createFixture()
    const unresolvedServerFixture = await createFixture()
    const unresolvedClientFixture = await createFixture()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'message_start',
            message: { id: 'msg_resolved_server_tool', usage: { input_tokens: 2 } },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'server_tool_use',
              id: 'srv_resolved',
              name: 'web_search',
              input: { query: 'resolved' },
            },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: {
              type: 'web_search_tool_result',
              tool_use_id: 'srv_resolved',
              content: [],
            },
          },
          { type: 'content_block_stop', index: 1 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'max_tokens' },
            usage: { output_tokens: 3 },
          },
          { type: 'message_stop' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'message_start',
            message: { id: 'msg_unresolved_server_tool', usage: { input_tokens: 2 } },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'server_tool_use',
              id: 'srv_unresolved',
              name: 'web_search',
              input: { query: 'unresolved' },
            },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'model_context_window_exceeded' },
            usage: { output_tokens: 3 },
          },
          { type: 'message_stop' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'message_start',
            message: { id: 'msg_unresolved_client_tool', usage: { input_tokens: 2 } },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'tool_unresolved',
              name: 'get_weather',
              input: { city: 'Shanghai' },
            },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'max_tokens' },
            usage: { output_tokens: 3 },
          },
          { type: 'message_stop' },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    await anthropicEngine.runAnthropicEngine(resolvedFixture)
    await anthropicEngine.runAnthropicEngine(unresolvedServerFixture)
    await anthropicEngine.runAnthropicEngine(unresolvedClientFixture)

    const [resolvedMessage, unresolvedServerMessage, unresolvedClientMessage] = await Promise.all([
      dbClient.db.query.messages.findFirst({
        where: eq(schema.messages.id, resolvedFixture.assistantMessage.id),
      }),
      dbClient.db.query.messages.findFirst({
        where: eq(schema.messages.id, unresolvedServerFixture.assistantMessage.id),
      }),
      dbClient.db.query.messages.findFirst({
        where: eq(schema.messages.id, unresolvedClientFixture.assistantMessage.id),
      }),
    ])

    expect(resolvedMessage).toMatchObject({
      status: 'interrupted',
      providerReplayContext: {
        protocol: 'anthropic_messages',
        content: [
          { type: 'server_tool_use', id: 'srv_resolved' },
          { type: 'web_search_tool_result', tool_use_id: 'srv_resolved' },
        ],
      },
    })
    expect(unresolvedServerMessage).toMatchObject({
      status: 'interrupted',
      providerReplayContext: null,
    })
    expect(unresolvedClientMessage).toMatchObject({
      status: 'interrupted',
      providerReplayContext: null,
    })
  })

  it('接受完整 message_delta 后直接 EOF 的 Anthropic 兼容网关', async () => {
    const fixture = await createFixture()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        {
          type: 'message_start',
          message: { id: 'msg_without_stop', usage: { input_tokens: 4, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '完成' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 1 },
        },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    await anthropicEngine.runAnthropicEngine(fixture)

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const storedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const eventTypes = await dbClient.db
      .select({ type: schema.runEvents.type })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(storedMessage).toMatchObject({
      status: 'complete',
      content: [{ type: 'output_text', text: '完成' }],
      inputTokens: 4,
      outputTokens: 1,
      totalTokens: 5,
    })
    expect(storedRun?.state).toBe('completed')
    expect(eventTypes.map((event) => event.type)).toContain('run.done')
    expect(eventTypes.map((event) => event.type)).not.toContain('run.error')
  })

  it('上游错误回显不会泄漏 Anthropic opaque 内容', async () => {
    const fixture = await createFixture()
    const opaqueSignature = 'opaque-signature-in-error'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        sseResponse([
          {
            type: 'message_start',
            message: { id: 'msg_error', usage: { input_tokens: 1, output_tokens: 0 } },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: opaqueSignature },
          },
          {
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: `Invalid signature ${opaqueSignature}`,
            },
          },
        ]),
      ),
    )

    await anthropicEngine.runAnthropicEngine(fixture)

    const storedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, fixture.assistantMessage.id),
    })
    const storedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, fixture.run.id),
    })
    const storedErrors = await dbClient.db
      .select()
      .from(schema.errorLogs)
      .where(eq(schema.errorLogs.runId, fixture.run.id))
    const browserEvents = await dbClient.db
      .select({ data: schema.runEvents.data })
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, fixture.run.id))

    expect(JSON.stringify({ storedMessage, storedRun, storedErrors, browserEvents })).not.toContain(
      opaqueSignature,
    )
    expect(storedMessage?.errorMessage).toContain('[provider opaque content omitted]')
    expect(storedErrors).toEqual([
      expect.objectContaining({
        errorType: 'invalid_request_error',
        httpStatus: 400,
      }),
    ])
  })
})
