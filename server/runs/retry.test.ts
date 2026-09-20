import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from '@shared/schemas/retry'
import type { ModelKind } from '@shared/types/domain'
import { initialLive, reduceEvent, reduceEvents } from '../../web/src/sse/eventReducer'

let directory: string
let client: typeof import('../db/client')
let schema: typeof import('../db/schema')
let engines: Record<ModelKind, (ctx: import('./types').EngineContext) => Promise<void>>
let config: typeof import('../services/appConfig')
let stats: typeof import('../services/stats')
let counter = 0

beforeAll(async () => {
  mkdirSync('.tmp', { recursive: true })
  directory = mkdtempSync(join(process.cwd(), '.tmp', 'run-retry-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = directory
  process.env.DATABASE_URL = join(directory, 'test.db')
  process.env.SESSION_SECRET = 'test-session-secret-run-retry'
  vi.resetModules()
  client = await import('../db/client')
  schema = await import('../db/schema')
  const migration = await import('../db/migrate')
  migration.runMigrations()
  config = await import('../services/appConfig')
  stats = await import('../services/stats')
  engines = {
    responses: (await import('./engine')).runEngine,
    chat: (await import('./chat-engine')).runChatEngine,
    anthropic: (await import('./anthropic-engine')).runAnthropicEngine,
    image: (await import('./image-run')).runImageEngine,
  }
})
beforeEach(async () => {
  await setPolicy()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterAll(() => {
  client?.sqlite.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function setPolicy(patch: Partial<RetryPolicy> = {}) {
  await config.updateAppConfig({
    upstreamRetry: {
      ...DEFAULT_RETRY_POLICY,
      enabled: true,
      initialDelaySeconds: 1,
      jitterPercent: 0,
      maxRetries: 2,
      attemptTimeoutSeconds: 5,
      maxElapsedSeconds: 60,
      streamIdleTimeoutSeconds: 5,
      ...patch,
    },
  })
}
function fixture(kind: ModelKind = 'responses', reasoning = false) {
  const user = client.db
    .insert(schema.users)
    .values({ username: `retry-user-${counter++}`, passwordHash: 'hash' })
    .returning()
    .get()
  const provider = client.db
    .insert(schema.providers)
    .values({
      name: 'Retry provider',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      protocol: kind === 'anthropic' ? 'anthropic' : 'openai',
    })
    .returning()
    .get()
  const model = client.db
    .insert(schema.models)
    .values({
      providerId: provider.id,
      modelId: 'test-model',
      displayName: 'Retry model',
      kind,
      allowedEfforts: reasoning ? ['high'] : [],
      defaultEffort: reasoning ? 'high' : null,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        reasoning,
        image_generation: kind === 'image',
      },
    })
    .returning()
    .get()
  const conversation = client.db
    .insert(schema.conversations)
    .values({ userId: user.id, title: 'Retry test', modelId: model.id })
    .returning()
    .get()
  const assistantMessage = client.db
    .insert(schema.messages)
    .values({
      conversationId: conversation.id,
      role: 'assistant',
      status: 'streaming',
      content: [],
    })
    .returning()
    .get()
  const run = client.db
    .insert(schema.runs)
    .values({
      conversationId: conversation.id,
      userId: user.id,
      assistantMessageId: assistantMessage.id,
      modelId: model.id,
      state: 'queued',
    })
    .returning()
    .get()
  return {
    run,
    provider,
    model,
    conversation,
    assistantMessage,
    body: { model: model.modelId, input: [], messages: [] },
    abortController: new AbortController(),
  }
}
function snapshot(ctx: ReturnType<typeof fixture>) {
  const events = client.db
    .select()
    .from(schema.runEvents)
    .where(eq(schema.runEvents.runId, ctx.run.id))
    .orderBy(schema.runEvents.sequenceNumber)
    .all()
  return {
    run: client.db.select().from(schema.runs).where(eq(schema.runs.id, ctx.run.id)).get()!,
    message: client.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, ctx.assistantMessage.id))
      .get()!,
    logs: client.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.runId, ctx.run.id))
      .all(),
    errors: client.db
      .select()
      .from(schema.errorLogs)
      .where(eq(schema.errorLogs.runId, ctx.run.id))
      .all(),
    events,
    live: reduceEvents(
      initialLive(),
      events.map((event) => ({
        type: event.type,
        seq: event.sequenceNumber,
        data: event.data,
        createdAt: event.createdAt.getTime(),
      })),
    ),
  }
}
const sseText = (events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
const sse = (...events: unknown[]) =>
  new Response(sseText(events), { headers: { 'Content-Type': 'text/event-stream' } })
const delta = (text: string) => ({
  type: 'response.output_text.delta',
  item_id: 'answer',
  delta: text,
})
const overloaded = { type: 'error', code: 'server_is_overloaded', message: 'Temporary overload' }
const done = {
  type: 'response.completed',
  response: {
    status: 'completed',
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  },
}
const success = () => sse(delta('新回答'), done)

function controlledSse(...initialEvents: unknown[]) {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
  const push = (...events: unknown[]) =>
    controller.enqueue(new TextEncoder().encode(sseText(events)))
  push(...initialEvents)
  return { response, push, close: () => controller.close() }
}

function reasoningProtocol(kind: 'responses' | 'chat' | 'anthropic') {
  if (kind === 'chat')
    return {
      opening: [],
      reasoning: (text: string) => ({ choices: [{ delta: { reasoning_content: text } }] }),
      answer: (text: string) => [{ choices: [{ delta: { content: text } }] }],
      failure: { error: { type: 'server_error', message: 'Temporary failure' } },
      completion: [{ choices: [{ delta: {}, finish_reason: 'stop' }] }],
    }
  if (kind === 'anthropic')
    return {
      opening: [
        {
          type: 'message_start',
          message: { id: 'thinking-test', usage: { input_tokens: 3, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      ],
      reasoning: (text: string) => ({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: text },
      }),
      answer: (text: string) => [
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
      ],
      failure: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      completion: [
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ],
    }
  return {
    opening: [{ type: 'response.created' }],
    reasoning: (text: string) => ({ type: 'response.reasoning_summary_text.delta', delta: text }),
    answer: (text: string) => [delta(text)],
    failure: overloaded,
    completion: [done],
  }
}

async function drain(run: Promise<void>, ms = 3000) {
  await vi.advanceTimersByTimeAsync(ms)
  await run
}

describe('整次生成自动重试与审计', () => {
  it.each(['responses', 'chat', 'anthropic'] as const)(
    '%s 重试期间实时展示思考，实时、回放、消息读取只计当前尝试',
    async (kind) => {
      const ctx = fixture(kind, true)
      let live = initialLive()
      const { runEmitter } = await import('./emitter')
      onTestFinished(
        runEmitter.subscribe(ctx.run.id, (event) => {
          live = reduceEvent(live, {
            type: event.type,
            seq: event.sequenceNumber,
            data: event.data,
            createdAt: event.createdAt.getTime(),
          })
        }),
      )
      const protocol = reasoningProtocol(kind)
      const first = controlledSse(...protocol.opening, protocol.reasoning('旧思考'))
      const second = controlledSse(...protocol.opening)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response),
      )
      const task = engines[kind](ctx)
      await vi.advanceTimersByTimeAsync(2000)
      first.push(protocol.failure)
      await vi.advanceTimersByTimeAsync(0)
      expect(snapshot(ctx).live).toMatchObject({
        reasoningDurationMs: 2000,
        retry: { phase: 'waiting' },
      })

      await vi.advanceTimersByTimeAsync(3000)
      expect(snapshot(ctx).live.processSteps).toContainEqual(
        expect.objectContaining({ text: '旧思考' }),
      )
      expect(snapshot(ctx).live.reasoningDurationMs).toBe(2000)
      second.push(protocol.reasoning('新思考'))
      await vi.advanceTimersByTimeAsync(0)
      const streaming = snapshot(ctx)
      expect(streaming.run.state).toBe('running')
      expect(streaming.live).toMatchObject({
        text: '',
        reasoningDurationMs: null,
        answerStarted: false,
      })
      expect(streaming.live.retry).toBeUndefined()
      expect(streaming.live.processSteps).toContainEqual(
        expect.objectContaining({ text: '新思考' }),
      )
      expect(streaming.live.upstreamStartedAt).toBe(Date.now() - 2000)
      expect(live).toEqual(streaming.live)

      await vi.advanceTimersByTimeAsync(1000)
      second.push(protocol.reasoning('继续'))
      await vi.advanceTimersByTimeAsync(0)
      expect(snapshot(ctx).live.processSteps).toContainEqual(
        expect.objectContaining({ text: '新思考继续' }),
      )
      await vi.advanceTimersByTimeAsync(500)
      second.push(...protocol.answer('新回答'))
      await vi.advanceTimersByTimeAsync(0)
      expect(snapshot(ctx).live.reasoningDurationMs).toBe(3500)
      await vi.advanceTimersByTimeAsync(1000)
      second.push(...protocol.completion)
      second.close()
      await vi.advanceTimersByTimeAsync(0)
      await task

      const saved = snapshot(ctx)
      expect(saved.message.reasoningDurationMs).toBe(3500)
      expect(live.reasoningDurationMs).toBe(3500)
      expect(saved.message.generationDurationMs).toBe(7500)
      vi.setSystemTime(Date.now() + 60_000)
      expect(snapshot(ctx).live.reasoningDurationMs).toBe(3500)
      const { getMessageTimingByMessageId } = await import('../services/conversations')
      expect(
        (await getMessageTimingByMessageId([saved.message])).get(saved.message.id)
          ?.reasoningDurationMs,
      ).toBe(3500)
    },
  )

  it('新尝试始终无输出而取消时，保留的思考耗时不包含重试等待', async () => {
    const ctx = fixture('responses', true)
    const first = controlledSse(
      { type: 'response.created' },
      { type: 'response.reasoning_summary_text.delta', delta: '保留的思考' },
    )
    const fetch = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValue(sse(overloaded))
    vi.stubGlobal('fetch', fetch)
    const task = engines.responses(ctx)
    await vi.advanceTimersByTimeAsync(2000)
    first.push(overloaded)
    await vi.advanceTimersByTimeAsync(2500)
    ctx.abortController.abort()
    await vi.advanceTimersByTimeAsync(0)
    await task
    const saved = snapshot(ctx)
    expect(saved.run.state).toBe('canceled')
    expect(saved.message.reasoningDurationMs).toBe(2000)
    expect(saved.live.reasoningDurationMs).toBe(2000)
    expect(saved.message.generationDurationMs).toBe(4500)
    expect(saved.message.processSteps).toEqual([{ kind: 'reasoning', text: '保留的思考' }])
  })

  it('空正文 delta 不结束思考，只有真实终答才开始折叠', async () => {
    const ctx = fixture('responses', true)
    const upstream = controlledSse({ type: 'response.created' }, delta(''))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream.response))
    const task = engines.responses(ctx)
    await vi.advanceTimersByTimeAsync(1000)
    expect(snapshot(ctx).live.answerStarted).toBe(false)
    upstream.push({ type: 'response.reasoning_summary_text.delta', delta: '思考中' })
    await vi.advanceTimersByTimeAsync(2000)
    upstream.push(delta('回答'), done)
    await vi.advanceTimersByTimeAsync(0)
    await task
    expect(snapshot(ctx).message.reasoningDurationMs).toBe(3000)
  })

  it('始终没有正文时，空 delta 不把整次思考耗时截为零', async () => {
    const ctx = fixture('responses', true)
    const upstream = controlledSse({ type: 'response.created' }, delta(''))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream.response))
    const task = engines.responses(ctx)
    await vi.advanceTimersByTimeAsync(1000)
    upstream.push({ type: 'response.reasoning_summary_text.delta', delta: '思考中' })
    await vi.advanceTimersByTimeAsync(2000)
    upstream.push(done)
    await vi.advanceTimersByTimeAsync(0)
    await task
    expect(snapshot(ctx).message.reasoningDurationMs).toBe(3000)
    expect(snapshot(ctx).logs[0]?.firstTokenLatencyMs).toBeNull()
  })

  it.each([
    { status: 520, format: 'html', message: '上游服务暂时不可用（HTTP 520）。' },
    { status: 520, format: 'json', message: '上游服务返回错误（HTTP 520）。' },
    { status: 524, format: 'html', message: '上游服务响应超时（HTTP 524），请稍后重试。' },
    { status: 524, format: 'json', message: '上游服务响应超时（HTTP 524），请稍后重试。' },
  ])(
    '$status 的 $format 错误页重试后恢复，原文仅进入脱敏诊断',
    async ({ status, format, message }) => {
      const ctx = fixture()
      const rawHtml =
        `<!DOCTYPE html><html><title>${status}: Upstream error</title>` +
        '<body>"signature":"test-private-signature"' +
        'x'.repeat(9000) +
        '</body></html>'
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            format === 'html'
              ? rawHtml
              : JSON.stringify({
                  error: { type: 'server_error', code: 'internal_server_error', message: rawHtml },
                }),
            { status, headers: { 'Retry-After': '2' } },
          ),
        )
        .mockImplementation(success)
      vi.stubGlobal('fetch', fetch)
      const task = engines.responses(ctx)
      await vi.advanceTimersByTimeAsync(1999)
      expect(fetch).toHaveBeenCalledTimes(1)
      await drain(task, 1)

      const saved = snapshot(ctx)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(saved.run.state).toBe('completed')
      expect(saved.live.text).toBe('新回答')
      expect(saved.logs).toHaveLength(1)
      expect(saved.logs[0]?.retrySummary).toMatchObject({ attempts: 2, outcome: 'completed' })
      const failure = saved.logs[0]?.retrySummary?.failures[0]
      expect(failure).toMatchObject({
        attempt: 1,
        stage: 'connecting',
        httpStatus: status,
        message,
        stopReason: null,
      })
      expect(failure?.rawMessage).toHaveLength(8192)
      expect(failure?.rawMessage).toContain('"signature":null')
      expect(failure?.rawMessage).not.toContain('test-private-signature')
      expect(saved.errors).toHaveLength(1)
      expect(saved.errors[0]?.message).toBe(failure?.message)
      expect(saved.errors[0]?.detail).toMatchObject({
        retry: { failures: [{ rawMessage: failure?.rawMessage }] },
      })
      expect(JSON.stringify(saved.events)).not.toContain('<!DOCTYPE html>')
    },
  )

  it.each([
    ['responses', 'eof'],
    ['responses', 'timeout'],
    ['chat', 'eof'],
    ['chat', 'timeout'],
    ['anthropic', 'eof'],
    ['anthropic', 'timeout'],
  ] as const)('%s 拒绝标记之后断流或超时不进入自动重试：%s', async (kind, ending) => {
    const ctx = fixture(kind)
    const events =
      kind === 'responses'
        ? [delta('部分内容'), { type: 'response.refusal.delta', delta: 'Refused' }]
        : kind === 'chat'
          ? [{ choices: [{ delta: { content: '部分内容', refusal: 'Refused' } }] }]
          : [
              {
                type: 'message_start',
                message: {
                  id: 'refused',
                  content: [],
                  usage: { input_tokens: 1, output_tokens: 0 },
                },
              },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: '部分内容' },
              },
              { type: 'content_block_stop', index: 0 },
              {
                type: 'message_delta',
                delta: { stop_reason: 'refusal' },
                usage: { output_tokens: 1 },
              },
            ]
    const fetch = vi.fn().mockImplementation(
      (_url, init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sseText(events)))
              if (ending === 'eof') controller.close()
              else
                init.signal?.addEventListener(
                  'abort',
                  () => controller.error(init.signal?.reason),
                  { once: true },
                )
            },
          }),
        ),
    )
    vi.stubGlobal('fetch', fetch)
    await drain(engines[kind](ctx), 6000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(snapshot(ctx).live.text).toBe('')
    expect(snapshot(ctx).message.content).toEqual([])
    expect(snapshot(ctx).logs[0]?.terminalReason).toBe('refusal')
  })
  it('已收到 HTTP 错误前没有连接成功，网络失败不伪造 HTTP 状态', async () => {
    const ctx = fixture()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockImplementation(success),
    )
    await drain(engines.responses(ctx))
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures[0]).toMatchObject({
      stage: 'connecting',
      httpStatus: null,
    })
  })

  it('关闭自动重试仍完整记录首次失败，不设置超时或发起额外请求', async () => {
    await setPolicy({ enabled: false })
    const ctx = fixture()
    const fetch = vi.fn().mockResolvedValue(sse(overloaded))
    vi.stubGlobal('fetch', fetch)
    await engines.responses(ctx)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures[0]?.stopReason).toBe('disabled')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('新尝试开始后停止，不清空上一次内容，也不继续重试', async () => {
    const ctx = fixture()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(sse(delta('保留部分'), overloaded))
      .mockImplementation(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            })
          }),
      )
    vi.stubGlobal('fetch', fetch)
    const task = engines.responses(ctx)
    await vi.advanceTimersByTimeAsync(1000)
    ctx.abortController.abort()
    await task
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(snapshot(ctx).live.text).toBe('保留部分')
    expect(snapshot(ctx).live.status).toBe('canceled')
    expect(snapshot(ctx).logs).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('正常输出可以超过重试总时间，关闭停滞超时后仍可等待完成', async () => {
    await setPolicy({ attemptTimeoutSeconds: 1, maxElapsedSeconds: 2, streamIdleTimeoutSeconds: 0 })
    const ctx = fixture()
    const fetch = vi.fn().mockImplementation(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sseText([delta('正常输出')])))
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode(sseText([done])))
                controller.close()
              }, 10000)
            },
          }),
        ),
    )
    vi.stubGlobal('fetch', fetch)
    await drain(engines.responses(ctx), 10000)
    expect(snapshot(ctx).run.state).toBe('completed')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('重试取代图片预览后清理旧附件，刷新回放不恢复已删除图片', async () => {
    const ctx = fixture()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          sse(
            {
              type: 'response.image_generation_call.partial_image',
              item_id: 'image-1',
              partial_image_b64: 'aW1hZ2U=',
              partial_image_index: 0,
            },
            overloaded,
          ),
        )
        .mockImplementation(success),
    )
    const task = engines.responses(ctx)
    await vi.advanceTimersByTimeAsync(0)
    const before = snapshot(ctx)
    expect(before.live.imageGenerations).toHaveLength(1)
    expect(
      client.db
        .select()
        .from(schema.attachments)
        .where(eq(schema.attachments.messageId, ctx.assistantMessage.id))
        .all(),
    ).toHaveLength(1)
    await drain(task)
    expect(snapshot(ctx).live.imageGenerations).toEqual([])
    expect(
      client.db
        .select()
        .from(schema.attachments)
        .where(eq(schema.attachments.messageId, ctx.assistantMessage.id))
        .all(),
    ).toEqual([])
    expect(
      snapshot(ctx).events.find((event) => event.type === 'image.generation.partial')?.data,
    ).toMatchObject({ attachmentId: null, attachmentDeleted: true })
  })
  it.each([
    overloaded,
    {
      type: 'error',
      error: { type: 'server_error', code: 'server_is_overloaded', message: 'Temporary overload' },
    },
    {
      type: 'response.failed',
      response: { status: 'failed', error: { code: 'server_error', message: 'Temporary failure' } },
    },
  ])('HTTP 200 后尚未输出的流内错误可恢复：%j', async (error) => {
    const ctx = fixture()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(sse({ type: 'response.created' }, error))
      .mockImplementation(success)
    vi.stubGlobal('fetch', fetch)
    await drain(engines.responses(ctx))
    const saved = snapshot(ctx)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(saved.run.state).toBe('completed')
    expect(saved.logs).toHaveLength(1)
    expect(saved.logs[0]?.retrySummary).toMatchObject({
      attempts: 2,
      outcome: 'completed',
      failures: [{ stage: 'before_output', httpStatus: 200 }],
    })
    expect(saved.errors).toHaveLength(1)
    expect(saved.errors[0]?.detail?.retry).toMatchObject({ outcome: 'completed' })
    expect(saved.live.text).toBe('新回答')
    expect(saved.live.retry).toBeUndefined()
    expect(fetch.mock.calls[0]?.[1].body).toBe(fetch.mock.calls[1]?.[1].body)
  })

  it('尚未输出就 EOF 也能重试；元数据、空 delta 不算首次输出', async () => {
    const ctx = fixture()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(sse({ type: 'response.created' }, delta('')))
        .mockImplementation(success),
    )
    await drain(engines.responses(ctx))
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures[0]).toMatchObject({
      stage: 'before_output',
      errorType: 'incomplete_stream',
    })
  })

  it.each([delta('旧回答'), { type: 'response.reasoning_summary_text.delta', delta: '旧思考' }])(
    '输出后重试原子替换正文和思考，并累加已知用量',
    async (output) => {
      const ctx = fixture()
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            sse(output, {
              type: 'response.failed',
              response: {
                status: 'failed',
                error: { code: 'server_error', message: 'Temporary failure' },
                usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
              },
            }),
          )
          .mockImplementation(success),
      )
      const task = engines.responses(ctx)
      await vi.advanceTimersByTimeAsync(0)
      expect(snapshot(ctx).live.retry?.stage).toBe('after_output')
      expect(snapshot(ctx).live.text || snapshot(ctx).live.processSteps.length).toBeTruthy()
      await drain(task)
      const saved = snapshot(ctx)
      expect(saved.live.text).toBe('新回答')
      expect(saved.live.processSteps).toEqual([])
      expect(saved.message.content).toEqual([{ type: 'output_text', text: '新回答' }])
      expect(saved.logs[0]?.totalTokens).toBe(16)
      expect(saved.events.filter((event) => event.type === 'run.output_reset')).toHaveLength(1)
      expect(saved.events.filter((event) => event.type === 'run.done')).toHaveLength(1)
    },
  )

  it('关闭输出后重试时保留已有回答', async () => {
    await setPolicy({ retryAfterOutput: false })
    const ctx = fixture()
    const fetch = vi.fn().mockResolvedValue(sse(delta('保留部分'), overloaded))
    vi.stubGlobal('fetch', fetch)
    await engines.responses(ctx)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(snapshot(ctx).live.text).toBe('保留部分')
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures[0]?.stopReason).toBe(
      'output_retry_disabled',
    )
  })

  it('下一次尝试一直没有输出，失败时仍保留原有内容与唯一结算', async () => {
    const ctx = fixture()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(sse(delta('保留部分'), overloaded))
      .mockImplementation(() => sse(overloaded))
    vi.stubGlobal('fetch', fetch)
    await drain(engines.responses(ctx))
    const saved = snapshot(ctx)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(saved.live.text).toBe('保留部分')
    expect(saved.message.content).toEqual([{ type: 'output_text', text: '保留部分' }])
    expect(saved.logs).toHaveLength(1)
    expect(saved.logs[0]?.retrySummary?.failures.at(-1)?.stopReason).toBe('attempts_exhausted')
    expect(saved.events.some((event) => event.type === 'run.output_reset')).toBe(false)
  })

  it('等待时停止立即结束，不再发请求，保留原回答和取消审计', async () => {
    const ctx = fixture()
    const fetch = vi.fn().mockResolvedValue(sse(delta('保留部分'), overloaded))
    vi.stubGlobal('fetch', fetch)
    const task = engines.responses(ctx)
    await vi.advanceTimersByTimeAsync(0)
    ctx.abortController.abort()
    await task
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(snapshot(ctx).run.state).toBe('canceled')
    expect(snapshot(ctx).live.text).toBe('保留部分')
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures[0]?.stopReason).toBe('canceled')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('HTTP 错误和流内错误共用次数预算，遵守 Retry-After', async () => {
    const ctx = fixture()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Retry-After': '4' } }))
      .mockImplementation(() => sse(overloaded))
    vi.stubGlobal('fetch', fetch)
    const task = engines.responses(ctx)
    await vi.advanceTimersByTimeAsync(3999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await drain(task, 2001)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures.map((failure) => failure.stage)).toEqual([
      'connecting',
      'before_output',
      'before_output',
    ])
  })

  it.each([
    'insufficient_quota',
    'invalid_api_key',
    'invalid_request_error',
    'content_filter',
    'unknown_error',
  ])('不重试永久或未知错误：%s', async (code) => {
    const ctx = fixture()
    const fetch = vi.fn().mockResolvedValue(sse({ type: 'error', code, message: 'Stopped' }))
    vi.stubGlobal('fetch', fetch)
    await engines.responses(ctx)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures[0]?.stopReason).toBe('not_retryable')
  })

  it('禁用的错误类别不会被 SSE code 绕过', async () => {
    await setPolicy({ retryStatusCodes: [429] })
    const ctx = fixture()
    const fetch = vi.fn().mockResolvedValue(sse(overloaded))
    vi.stubGlobal('fetch', fetch)
    await engines.responses(ctx)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])(
    '已连通但挂起会按首次输出或停滞超时重试：已有输出=%s',
    async (withOutput) => {
      const ctx = fixture()
      const fetch = vi
        .fn()
        .mockImplementationOnce(
          (_url, init: RequestInit) =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      sseText([
                        { type: 'response.created' },
                        ...(withOutput ? [delta('旧回答')] : []),
                      ]),
                    ),
                  )
                  init.signal?.addEventListener(
                    'abort',
                    () => controller.error(init.signal?.reason),
                    { once: true },
                  )
                },
              }),
            ),
        )
        .mockImplementation(success)
      vi.stubGlobal('fetch', fetch)
      await drain(engines.responses(ctx), 6000)
      expect(fetch).toHaveBeenCalledTimes(2)
      const failure = snapshot(ctx).logs[0]?.retrySummary?.failures[0]
      expect(failure?.stage).toBe(withOutput ? 'after_output' : 'before_output')
      expect(failure?.errorType).toBe(withOutput ? 'stream_idle_timeout' : 'first_output_timeout')
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('重试总时间耗尽后不再发下一次请求', async () => {
    await setPolicy({ attemptTimeoutSeconds: 1, maxElapsedSeconds: 2 })
    const ctx = fixture()
    const fetch = vi.fn().mockImplementation(() => sse(overloaded))
    vi.stubGlobal('fetch', fetch)
    await drain(engines.responses(ctx))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures.at(-1)?.stopReason).toBe(
      'budget_exhausted',
    )
  })

  it('请求与错误审计在删除聊天后保留重试经过', async () => {
    const ctx = fixture()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(sse(overloaded)).mockImplementation(success),
    )
    await drain(engines.responses(ctx))
    client.db
      .delete(schema.conversations)
      .where(eq(schema.conversations.id, ctx.conversation.id))
      .run()
    const usage = await stats.listUsageEvents({ userId: ctx.run.userId })
    const errors = await stats.listErrorEvents({ userId: ctx.run.userId })
    expect(usage.items[0]).toMatchObject({
      runId: null,
      retrySummary: { attempts: 2, outcome: 'completed' },
    })
    expect(errors.items[0]).toMatchObject({
      runId: null,
      retrySummary: { attempts: 2, outcome: 'completed' },
    })
  })

  it('Chat Completions 首字后的断流重试不会拼接两次回答', async () => {
    const ctx = fixture('chat')
    const chunk = (text: string, finish: string | null = null) => ({
      choices: [{ delta: { content: text }, finish_reason: finish }],
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(sse(chunk('旧回答')))
      .mockResolvedValue(sse(chunk('新回答', 'stop')))
    vi.stubGlobal('fetch', fetch)
    await drain(engines.chat(ctx))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(snapshot(ctx).live.text).toBe('新回答')
  })

  it('Anthropic 流内过载重试保留失败用量，使用新的 block 累积器', async () => {
    const ctx = fixture('anthropic')
    const start = {
      type: 'message_start',
      message: { id: 'msg-test', usage: { input_tokens: 3, output_tokens: 0 } },
    }
    const block = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }
    const text = (value: string) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: value },
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          sse(start, block, text('旧回答'), {
            type: 'error',
            error: { type: 'overloaded_error', message: 'Overloaded' },
          }),
        )
        .mockResolvedValue(
          sse(
            start,
            block,
            text('新回答'),
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: 2 },
            },
            { type: 'message_stop' },
          ),
        ),
    )
    await drain(engines.anthropic(ctx))
    expect(snapshot(ctx).live.text).toBe('新回答')
    expect(snapshot(ctx).logs[0]?.inputTokens).toBe(6)
    expect(snapshot(ctx).logs[0]?.retrySummary?.attempts).toBe(2)
  })

  it('Images API 的 HTTP 200 错误同样进入重试和审计', async () => {
    const ctx = fixture('image')
    const fetch = vi
      .fn()
      .mockImplementation(
        () =>
          new Response(
            JSON.stringify({ error: { code: 'server_is_overloaded', message: 'Overloaded' } }),
          ),
      )
    vi.stubGlobal('fetch', fetch)
    await drain(engines.image(ctx))
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(snapshot(ctx).logs[0]?.retrySummary?.failures[0]?.stage).toBe('before_output')
  })
})
