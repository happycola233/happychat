import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let temporaryDirectory: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let chatEngine: typeof import('./chat-engine')
let fixtureSequence = 0

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'happychat-chat-engine-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-chat-engine'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  chatEngine = await import('./chat-engine')
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

function chatSseResponse(
  events: Array<Record<string, unknown>>,
  options: { done?: boolean } = {},
): Response {
  const eventBody = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  const doneBody = options.done === false ? '' : 'data: [DONE]\n\n'
  return new Response(eventBody + doneBody, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function rawSseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function chatChunk(options: {
  content?: string
  reasoningContent?: string
  refusal?: string
  toolCalls?: unknown[]
  functionCall?: unknown
  finishReason?: string | null
  usage?: Record<string, unknown>
}): Record<string, unknown> {
  const delta: Record<string, unknown> = {}
  if (options.content !== undefined) delta.content = options.content
  if (options.reasoningContent !== undefined) delta.reasoning_content = options.reasoningContent
  if (options.refusal !== undefined) delta.refusal = options.refusal
  if (options.toolCalls !== undefined) delta.tool_calls = options.toolCalls
  if (options.functionCall !== undefined) delta.function_call = options.functionCall

  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: options.finishReason ?? null,
      },
    ],
    ...(options.usage ? { usage: options.usage } : {}),
  }
}

async function createFixture() {
  fixtureSequence += 1
  const [user] = await dbClient.db
    .insert(schema.users)
    .values({ username: `chat-engine-user-${fixtureSequence}`, passwordHash: 'hash' })
    .returning()
  const [provider] = await dbClient.db
    .insert(schema.providers)
    .values({
      name: 'Chat provider',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      protocol: 'openai',
    })
    .returning()
  if (!user || !provider) throw new Error('Failed to create provider fixtures')

  const [model] = await dbClient.db
    .insert(schema.models)
    .values({
      providerId: provider.id,
      modelId: 'gpt-chat-test',
      displayName: 'GPT Chat Test',
      kind: 'chat',
      capabilities: {
        vision: true,
        file_input: true,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: ['low'],
      defaultEffort: 'low',
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
      requestParams: { reasoning_effort: 'low' },
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
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    },
    abortController: new AbortController(),
  }
}

async function readResult(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const storedRun = await dbClient.db.query.runs.findFirst({
    where: eq(schema.runs.id, fixture.run.id),
  })
  const storedMessage = await dbClient.db.query.messages.findFirst({
    where: eq(schema.messages.id, fixture.assistantMessage.id),
  })
  const usageLog = await dbClient.db.query.usageLogs.findFirst({
    where: eq(schema.usageLogs.runId, fixture.run.id),
  })
  return { storedRun, storedMessage, usageLog }
}

describe('runChatEngine', () => {
  it('completes only after a supported terminal finish reason', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        chatSseResponse([
          chatChunk({ reasoningContent: 'thinking' }),
          chatChunk({ content: 'answer' }),
          chatChunk({
            finishReason: 'stop',
            usage: {
              prompt_tokens: 4,
              completion_tokens: 2,
              total_tokens: 6,
              completion_tokens_details: { reasoning_tokens: 1 },
            },
          }),
        ]),
      ),
    )

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage, usageLog } = await readResult(fixture)
    expect(storedRun).toMatchObject({ state: 'completed', errorMessage: null })
    expect(storedMessage).toMatchObject({
      status: 'complete',
      content: [{ type: 'output_text', text: 'answer' }],
      reasoningSummary: 'thinking',
      inputTokens: 4,
      outputTokens: 2,
      reasoningTokens: 1,
      totalTokens: 6,
    })
    expect(usageLog).toMatchObject({ success: true })
  })

  it('marks length as incomplete instead of completed', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          chatSseResponse([
            chatChunk({ content: 'partial' }),
            chatChunk({ finishReason: 'length' }),
          ]),
        ),
    )

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage } = await readResult(fixture)
    expect(storedRun).toMatchObject({
      state: 'incomplete',
      incompleteReason: 'max_output_tokens',
    })
    expect(storedMessage).toMatchObject({
      status: 'interrupted',
      content: [{ type: 'output_text', text: 'partial' }],
    })
  })

  it('accepts an explicit [DONE] as a compatible terminal signal when finish_reason is omitted', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          chatSseResponse([chatChunk({ content: 'answer without finish reason' })]),
        ),
    )

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage, usageLog } = await readResult(fixture)
    expect(storedRun).toMatchObject({ state: 'completed', errorMessage: null })
    expect(storedMessage).toMatchObject({
      status: 'complete',
      content: [{ type: 'output_text', text: 'answer without finish reason' }],
    })
    expect(usageLog).toMatchObject({ success: true })
  })

  it('accepts finish_reason stop when a compatible gateway omits [DONE]', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        chatSseResponse([chatChunk({ content: 'answer' }), chatChunk({ finishReason: 'stop' })], {
          done: false,
        }),
      ),
    )

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage } = await readResult(fixture)
    expect(storedRun).toMatchObject({ state: 'completed', errorMessage: null })
    expect(storedMessage).toMatchObject({
      status: 'complete',
      content: [{ type: 'output_text', text: 'answer' }],
    })
  })

  it('ignores an empty refusal field emitted by a compatible gateway', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          chatSseResponse([
            chatChunk({ content: 'answer', refusal: '' }),
            chatChunk({ finishReason: 'stop' }),
          ]),
        ),
    )

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage } = await readResult(fixture)
    expect(storedRun).toMatchObject({ state: 'completed', errorMessage: null })
    expect(storedMessage).toMatchObject({
      status: 'complete',
      content: [{ type: 'output_text', text: 'answer' }],
    })
  })

  it.each([
    {
      label: 'tool_calls',
      events: [
        chatChunk({
          toolCalls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{}' } }],
        }),
        chatChunk({ finishReason: 'tool_calls' }),
      ],
    },
    {
      label: 'content_filter',
      events: [chatChunk({ content: 'partial' }), chatChunk({ finishReason: 'content_filter' })],
    },
    {
      label: 'function_call',
      events: [
        chatChunk({ functionCall: { name: 'lookup', arguments: '{}' } }),
        chatChunk({ finishReason: 'function_call' }),
      ],
    },
    {
      label: 'refusal',
      events: [
        chatChunk({ refusal: 'I cannot help with that.' }),
        chatChunk({ finishReason: 'stop' }),
      ],
    },
  ])('fails explicitly for unsupported $label output', async ({ label, events }) => {
    const fixture = await createFixture()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(chatSseResponse(events)))

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage, usageLog } = await readResult(fixture)
    expect(storedRun).toMatchObject({ state: 'failed' })
    expect(storedRun?.errorMessage).toBeTruthy()
    expect(storedMessage).toMatchObject({ status: 'error' })
    if (label === 'content_filter' || label === 'refusal') {
      expect(storedMessage?.content).toEqual([])
    }
    expect(usageLog).toMatchObject({ success: false })
  })

  it('fails when the upstream sends an HTTP 200 error frame', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        chatSseResponse([
          {
            error: {
              message: 'upstream stream failed',
              type: 'server_error',
              code: 'stream_failed',
            },
          },
        ]),
      ),
    )

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage, usageLog } = await readResult(fixture)
    expect(storedRun).toMatchObject({ state: 'failed' })
    expect(storedRun?.errorMessage).toContain('upstream stream failed')
    expect(storedMessage).toMatchObject({ status: 'error' })
    expect(usageLog).toMatchObject({ success: false })
  })

  it('fails when an SSE data frame contains malformed JSON', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(rawSseResponse('data: {"choices":\n\n')),
    )

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage, usageLog } = await readResult(fixture)
    expect(storedRun).toMatchObject({ state: 'failed' })
    expect(storedRun?.errorMessage).toBeTruthy()
    expect(storedMessage).toMatchObject({ status: 'error' })
    expect(usageLog).toMatchObject({ success: false })
  })

  it('fails when deltas end at EOF without a finish reason or [DONE]', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(chatSseResponse([chatChunk({ content: 'partial' })], { done: false })),
    )

    await chatEngine.runChatEngine(fixture)

    const { storedRun, storedMessage, usageLog } = await readResult(fixture)
    expect(storedRun).toMatchObject({ state: 'failed' })
    expect(storedRun?.errorMessage).toBeTruthy()
    expect(storedMessage).toMatchObject({ status: 'error' })
    expect(usageLog).toMatchObject({ success: false })
  })
})
