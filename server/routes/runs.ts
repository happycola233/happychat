import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
import { regenerateSchema, sendMessageSchema } from '@shared/schemas/chat'
import type { ModelParams } from '@shared/types/domain'
import { RUN_EVENT_TYPE, isTerminalEventType } from '@shared/types/events'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { db } from '../db/client'
import { models, runEvents, runs } from '../db/schema'
import { requireUser } from '../auth/middleware'
import { jsonValidator } from '../http/validator'
import { must } from '../lib/assert'
import { getOwnedConversation, toConversationDTO, toMessageDTO } from '../services/conversations'
import { computeReasoningDurationMs, reasoningStartedAtMs } from '../services/reasoning-timing'
import { prepareRegenerate, prepareRun } from '../runs/prepare'
import { runManager } from '../runs/manager'
import { runEmitter, type RunEvent } from '../runs/emitter'
import type { AppEnv } from '../http/types'

export const runRoutes = new Hono<AppEnv>()

runRoutes.use('*', requireUser)

const TERMINAL_STATES = ['completed', 'incomplete', 'failed', 'canceled', 'interrupted']
const isTerminalState = (s: string) => TERMINAL_STATES.includes(s)

function terminalTypeFor(state: string): string {
  switch (state) {
    case 'failed':
      return RUN_EVENT_TYPE.error
    case 'canceled':
      return RUN_EVENT_TYPE.canceled
    case 'interrupted':
      return RUN_EVENT_TYPE.interrupted
    default:
      return RUN_EVENT_TYPE.done
  }
}

async function getOwnedRun(userId: string, id: string) {
  const [r] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)))
    .limit(1)
  return r ?? null
}

/** 启动一次流式生成；立即返回 runId 与消息占位。生成在进程内持续，断开不影响。 */
runRoutes.post('/', jsonValidator(sendMessageSchema), async (c) => {
  const user = c.get('user')
  const input = c.req.valid('json')
  const prepared = await prepareRun({
    userId: user.id,
    conversationId: input.conversationId,
    modelId: input.modelId,
    text: input.text,
    params: input.params,
    clientLocale: input.clientLocale,
    clientTimezone: input.clientTimezone,
    idempotencyKey: input.idempotencyKey,
    parentId: input.parentId,
    attachments: input.attachments,
    imageSources: input.imageSources,
  })
  if (!prepared.ok) {
    return c.json({ error: { message: prepared.message, code: prepared.code } }, prepared.status)
  }
  runManager.start({
    run: prepared.run,
    assistantMessage: prepared.assistantMessage,
    conversation: prepared.conversation,
    model: prepared.model,
    provider: prepared.provider,
    body: prepared.body,
    imageOperation: prepared.imageOperation,
  })
  return c.json({
    runId: prepared.run.id,
    conversation: toConversationDTO(prepared.conversation),
    userMessage: toMessageDTO(must(prepared.userMessage)),
    assistantMessage: toMessageDTO(prepared.assistantMessage),
  })
})

/** 重新生成：在原用户消息下新增兄弟助手分支并流式生成。 */
runRoutes.post('/regenerate', jsonValidator(regenerateSchema), async (c) => {
  const user = c.get('user')
  const input = c.req.valid('json')
  const prepared = await prepareRegenerate({
    userId: user.id,
    assistantMessageId: input.assistantMessageId,
    modelId: input.modelId,
    params: input.params,
    clientLocale: input.clientLocale,
    idempotencyKey: input.idempotencyKey,
  })
  if (!prepared.ok) {
    return c.json({ error: { message: prepared.message, code: prepared.code } }, prepared.status)
  }
  runManager.start({
    run: prepared.run,
    assistantMessage: prepared.assistantMessage,
    conversation: prepared.conversation,
    model: prepared.model,
    provider: prepared.provider,
    body: prepared.body,
    imageOperation: prepared.imageOperation,
  })
  return c.json({
    runId: prepared.run.id,
    conversation: toConversationDTO(prepared.conversation),
    assistantMessage: toMessageDTO(prepared.assistantMessage),
  })
})

/** 查询某会话当前未完成的 run（刷新后重连用）。 */
runRoutes.get('/active', async (c) => {
  const conversationId = c.req.query('conversationId')
  if (!conversationId) return c.json({ run: null })
  const conv = await getOwnedConversation(c.get('user').id, conversationId)
  if (!conv) return c.json({ run: null })
  const [r] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.conversationId, conversationId), inArray(runs.state, ['queued', 'running'])))
    .orderBy(desc(runs.createdAt))
    .limit(1)
  if (!r) return c.json({ run: null })

  const [model] = r.modelId
    ? await db.select().from(models).where(eq(models.id, r.modelId)).limit(1)
    : []
  const eventRows = await db
    .select({
      type: runEvents.type,
      sequenceNumber: runEvents.sequenceNumber,
      createdAt: runEvents.createdAt,
    })
    .from(runEvents)
    .where(eq(runEvents.runId, r.id))
    .orderBy(asc(runEvents.sequenceNumber))
  const firstImageEvent = eventRows.find((ev) => ev.type === 'image.generation.in_progress')

  return c.json({
    run: {
      runId: r.id,
      assistantMessageId: r.assistantMessageId,
      lastSequenceNumber: r.lastSequenceNumber,
      upstreamStartedAt: reasoningStartedAtMs(eventRows),
      reasoningDurationMs: computeReasoningDurationMs(eventRows),
      imageStartedAt: firstImageEvent?.createdAt.getTime() ?? null,
      reasoningEnabled: isReasoningEnabled(model, r.requestParams as ModelParams | null),
    },
  })
})

/** 中止生成（仅显式调用才中止；断开/导航不中止）。 */
runRoutes.delete('/:id', async (c) => {
  const run = await getOwnedRun(c.get('user').id, c.req.param('id'))
  if (!run) return c.json({ error: { message: '任务不存在', code: 'not_found' } }, 404)
  runManager.abort(run.id)
  return c.json({ ok: true })
})

/** SSE 续传流：?from=<seq> 游标（或 Last-Event-ID）。先订阅→回放→实时→终止关闭。 */
runRoutes.get('/:id/stream', async (c) => {
  const id = c.req.param('id')
  const run = await getOwnedRun(c.get('user').id, id)
  if (!run) return c.json({ error: { message: '任务不存在', code: 'not_found' } }, 404)

  const fromQuery = Number(c.req.query('from') ?? -1)
  const lastEventId = Number(c.req.header('Last-Event-ID') ?? -1)
  const from = Math.max(
    Number.isFinite(fromQuery) ? fromQuery : -1,
    Number.isFinite(lastEventId) ? lastEventId : -1,
  )

  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')
  c.header('Connection', 'keep-alive')

  return streamSSE(
    c,
    async (stream) => {
      const queue: RunEvent[] = []
      let waiter: (() => void) | null = null
      let aborted = false
      const onEvent = (ev: RunEvent) => {
        queue.push(ev)
        const w = waiter
        waiter = null
        w?.()
      }
      const unsub = runEmitter.subscribe(id, onEvent)
      stream.onAbort(() => {
        aborted = true
        const w = waiter
        waiter = null
        w?.()
      })

      const writeEvent = (type: string, seq: number, data: Record<string, unknown>) =>
        stream.writeSSE({ id: String(seq), data: JSON.stringify({ type, seq, data }) })

      const waitNext = () =>
        new Promise<void>((resolve) => {
          if (queue.length > 0 || aborted) {
            resolve()
            return
          }
          waiter = resolve
        })

      try {
        let lastSeq = from
        let sawTerminal = false

        // 1) 回放 DB 中 seq > from 的事件
        const backfill = await db
          .select()
          .from(runEvents)
          .where(and(eq(runEvents.runId, id), gt(runEvents.sequenceNumber, from)))
          .orderBy(asc(runEvents.sequenceNumber))
        for (const row of backfill) {
          if (aborted) return
          await writeEvent(row.type, row.sequenceNumber, row.data)
          lastSeq = Math.max(lastSeq, row.sequenceNumber)
          if (isTerminalEventType(row.type)) sawTerminal = true
        }
        if (sawTerminal) return

        // 2) 若引擎已结束（含启动中断），补发剩余事件，必要时合成终止事件
        const [fresh] = await db.select().from(runs).where(eq(runs.id, id)).limit(1)
        if (fresh && isTerminalState(fresh.state) && !runManager.isActive(id)) {
          const extra = await db
            .select()
            .from(runEvents)
            .where(and(eq(runEvents.runId, id), gt(runEvents.sequenceNumber, lastSeq)))
            .orderBy(asc(runEvents.sequenceNumber))
          for (const row of extra) {
            await writeEvent(row.type, row.sequenceNumber, row.data)
            lastSeq = Math.max(lastSeq, row.sequenceNumber)
            if (isTerminalEventType(row.type)) sawTerminal = true
          }
          if (!sawTerminal) {
            await writeEvent(terminalTypeFor(fresh.state), lastSeq + 1, { state: fresh.state })
          }
          return
        }

        // 3) 实时尾流，直到终止事件或客户端断开
        while (!aborted) {
          await waitNext()
          if (aborted) break
          while (queue.length > 0) {
            const ev = queue.shift()!
            if (ev.sequenceNumber <= lastSeq) continue
            await writeEvent(ev.type, ev.sequenceNumber, ev.data)
            lastSeq = ev.sequenceNumber
            if (isTerminalEventType(ev.type)) return
          }
        }
      } finally {
        unsub()
      }
    },
    async () => {
      // 客户端断开导致的写入异常忽略（不中止后台生成）
    },
  )
})
