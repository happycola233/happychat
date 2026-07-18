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
      replayReasoning: true,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
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
      reasoningSummary: '终态摘要',
      reasoningReplayContext: {
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
      reasoningSummary: '终态摘要',
      usage: { inputTokens: 12, outputTokens: 8, reasoningTokens: 3, totalTokens: 20 },
    })
    expect(done?.data).not.toHaveProperty('reasoningReplayContext')
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
      reasoningReplayContext: null,
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
    expect(serializedPersistentData).toContain('[encrypted_content omitted]')
    expect(storedMessage).toMatchObject({ status: 'error', reasoningReplayContext: null })
  })
})
