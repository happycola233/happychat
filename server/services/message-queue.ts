import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { MessageQueueAction, MessageQueueDTO } from '@shared/schemas/message-queue'
import { CONVERSATION_EVENT_TYPE } from '@shared/types/events'
import { db } from '../db/client'
import { attachments, conversations, messageQueues, messages, runs, users } from '../db/schema'
import { prepareRun } from '../runs/prepare'
import { runManager } from '../runs/manager'
import { withConversationSubmission } from '../runs/submission-lock'
import { uploadFileExists } from '../storage/files'
import { conversationEvents } from './conversation-events'

type QueueRow = typeof messageQueues.$inferSelect
const INCOMPLETE_HINT = '上一条回复未完成，待发送的消息已保留。'
const advancing = new Map<string, Promise<void>>()
const reorderTimers = new Map<string, ReturnType<typeof setTimeout>>()

export class MessageQueueError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
  }
}

export function getMessageQueue(conversationId: string): QueueRow | undefined {
  return db
    .select()
    .from(messageQueues)
    .where(eq(messageQueues.conversationId, conversationId))
    .get()
}

export function toMessageQueueDTO(queue: QueueRow): MessageQueueDTO {
  const { userId: _userId, preparingMessageId: _preparingMessageId, ...dto } = queue
  return dto
}

export function listMessageQueues(userId: string): MessageQueueDTO[] {
  return db
    .select()
    .from(messageQueues)
    .where(eq(messageQueues.userId, userId))
    .all()
    .map(toMessageQueueDTO)
}

function publish(queue: QueueRow): void {
  conversationEvents.emit(queue.userId, CONVERSATION_EVENT_TYPE.queueUpdated, {
    queue: toMessageQueueDTO(queue),
  })
}

function updateQueue(conversationId: string, patch: Partial<QueueRow>): QueueRow | undefined {
  const row = db
    .update(messageQueues)
    .set({ ...patch, revision: sql`${messageQueues.revision} + 1` })
    .where(eq(messageQueues.conversationId, conversationId))
    .returning()
    .get()
  if (row) publish(row)
  return row
}

export function activeConversationRun(conversationId: string) {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.conversationId, conversationId), inArray(runs.state, ['queued', 'running'])))
    .orderBy(desc(runs.createdAt))
    .get()
}

export function pauseMessageQueue(conversationId: string): void {
  updateQueue(conversationId, { paused: true, error: null })
}

export function waitMessageQueueForRun(
  conversationId: string,
  runId: string,
  assistantMessageId: string,
): void {
  // 失败后手动重新生成可能创建新分支；继续队列时应接在新的回复后面。
  updateQueue(conversationId, { waitingRunId: runId, parentId: assistantMessageId })
}

function cleanupPreparingMessage(queue: QueueRow): void {
  if (!queue.preparingMessageId) return
  db.transaction((tx) => {
    tx.update(attachments)
      .set({ messageId: null })
      .where(eq(attachments.messageId, queue.preparingMessageId!))
      .run()
    tx.delete(messages).where(eq(messages.id, queue.preparingMessageId!)).run()
    tx.update(messageQueues)
      .set({ preparingMessageId: null })
      .where(eq(messageQueues.conversationId, queue.conversationId))
      .run()
  })
}

/** 操作只改目标项，不回写整份客户端快照，避免多个标签页互相覆盖。 */
export function changeMessageQueue(
  userId: string,
  conversationId: string,
  action: MessageQueueAction,
): MessageQueueDTO {
  const result = db.transaction(
    (tx) => {
      const conversation = tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
        .get()
      if (!conversation) throw new MessageQueueError('聊天不存在', 404)
      let queue = getMessageQueue(conversationId)
      if (!queue) {
        queue = tx
          .insert(messageQueues)
          .values({ conversationId, userId, items: [], parentId: conversation.activeLeafId })
          .returning()
          .get()!
      }
      let patch: Partial<QueueRow> = {}
      if (action.type === 'enqueue') {
        // 同一入队请求重试时保持唯一；已经进入 run 的项也不能再次入队。
        if (
          queue.items.some((item) => item.id === action.message.id) ||
          tx
            .select({ id: runs.id })
            .from(runs)
            .where(eq(runs.idempotencyKey, `queue:${action.message.id}`))
            .get()
        )
          return queue
        if (
          action.parentId &&
          !tx
            .select({ id: messages.id })
            .from(messages)
            .where(
              and(eq(messages.id, action.parentId), eq(messages.conversationId, conversationId)),
            )
            .get()
        )
          throw new MessageQueueError('消息不在当前聊天中', 400)
        const message = structuredClone(action.message)
        const ids = [
          ...new Set([
            ...(message.input.attachments ?? []).map((a) => a.attachmentId),
            ...(message.input.imageSources ?? []).map((a) => a.attachmentId),
            ...(message.input.contextAttachments?.include ?? []),
          ]),
        ]
        const owned = ids.length
          ? tx
              .select()
              .from(attachments)
              .where(and(eq(attachments.userId, userId), inArray(attachments.id, ids)))
              .all()
          : []
        if (owned.length !== ids.length || owned.some((a) => !uploadFileExists(a.storagePath)))
          throw new MessageQueueError('附件已失效，请重新上传', 400)
        const byId = new Map(owned.map((a) => [a.id, a]))
        message.attachments = (message.input.attachments ?? []).map((ref) => {
          const a = byId.get(ref.attachmentId)!
          return {
            id: a.id,
            kind: a.kind,
            filename: a.filename,
            mime: a.mime,
            byteSize: a.byteSize,
          }
        })
        message.imageSources = (message.input.imageSources ?? []).map((ref) => ({
          attachmentId: ref.attachmentId,
          label: byId.get(ref.attachmentId)!.filename,
        }))
        message.input = { ...message.input, conversationId, idempotencyKey: `queue:${message.id}` }
        const active = activeConversationRun(conversationId)
        patch = { items: [...queue.items, message] }
        if (!queue.items.length && !queue.sendingId) {
          patch = {
            ...patch,
            parentId: active?.assistantMessageId ?? action.parentId,
            waitingRunId: active?.id ?? null,
            paused: false,
            error: null,
          }
        }
      } else if (action.type === 'remove' || action.type === 'take') {
        if (
          queue.sendingId === action.messageId ||
          !queue.items.some((item) => item.id === action.messageId)
        )
          throw new MessageQueueError('这条消息已开始发送，请刷新后查看', 409)
        patch.items = queue.items.filter((item) => item.id !== action.messageId)
        if (action.type === 'take') {
          const item = queue.items.find((item) => item.id === action.messageId)!
          const ids = [...(item.input.attachments ?? []), ...(item.input.imageSources ?? [])].map(
            (a) => a.attachmentId,
          )
          // 回到输入框后重新获得完整草稿保留期，不能立刻被 24 小时清理回收。
          if (ids.length)
            tx.update(attachments)
              .set({ createdAt: new Date() })
              .where(
                and(
                  eq(attachments.userId, userId),
                  inArray(attachments.id, ids),
                  sql`${attachments.messageId} IS NULL`,
                ),
              )
              .run()
        }
      } else if (action.type === 'reorder') {
        const items = [...queue.items]
        const from = items.findIndex((item) => item.id === action.messageId)
        const to = items.findIndex((item) => item.id === action.targetId)
        if (
          from >= 0 &&
          to >= 0 &&
          action.messageId !== queue.sendingId &&
          action.targetId !== queue.sendingId
        ) {
          const [moved] = items.splice(from, 1)
          items.splice(to, 0, moved!)
        }
        patch = { items, reorderUntil: null }
      } else if (action.type === 'hold') {
        // 拖动页面意外关闭也不会永久锁住队列；正常放下会立即解除。
        patch.reorderUntil = Date.now() + 30_000
      } else if (action.type === 'pause') {
        patch = { paused: true, error: null }
      } else {
        const active = activeConversationRun(conversationId)
        patch = {
          paused: false,
          error: null,
          waitingRunId: active?.id ?? null,
          ...(active?.assistantMessageId ? { parentId: active.assistantMessageId } : {}),
        }
      }
      return tx
        .update(messageQueues)
        .set({ ...patch, revision: queue.revision + 1 })
        .where(eq(messageQueues.conversationId, conversationId))
        .returning()
        .get()!
    },
    { behavior: 'immediate' },
  )
  publish(result)
  void advanceMessageQueue(conversationId)
  return toMessageQueueDTO(result)
}

/** 唯一的发送者在服务端。浏览器只保存/订阅队列，不负责触发模型调用。 */
export function advanceMessageQueue(conversationId: string): Promise<void> {
  const existing = advancing.get(conversationId)
  if (existing) return existing
  const work = withConversationSubmission(conversationId, async () => {
    let queue = getMessageQueue(conversationId)
    if (!queue || queue.sendingId) return
    if (queue.waitingRunId) {
      const previous = db.select().from(runs).where(eq(runs.id, queue.waitingRunId)).get()
      if (previous?.state === 'queued' || previous?.state === 'running') return
      const succeeded = previous?.state === 'completed' || previous?.state === 'incomplete'
      queue = updateQueue(conversationId, {
        waitingRunId: null,
        paused: queue.paused || !succeeded,
        error: succeeded ? queue.error : INCOMPLETE_HINT,
      })!
    }
    if (queue.paused || !queue.items.length) return
    if (queue.reorderUntil && queue.reorderUntil > Date.now()) {
      clearTimeout(reorderTimers.get(conversationId))
      const timer = setTimeout(() => {
        reorderTimers.delete(conversationId)
        void advanceMessageQueue(conversationId)
      }, queue.reorderUntil - Date.now())
      timer.unref()
      reorderTimers.set(conversationId, timer)
      return
    }
    const active = activeConversationRun(conversationId)
    if (active) {
      updateQueue(conversationId, { waitingRunId: active.id, parentId: active.assistantMessageId })
      return
    }
    const item = queue.items[0]!
    const owner = db
      .select({ disabled: users.disabled, mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, queue.userId))
      .get()!
    if (owner.disabled || owner.mustChangePassword) {
      updateQueue(conversationId, {
        paused: true,
        error: '账号暂时无法发送消息，请重新登录或联系管理员。',
      })
      return
    }
    updateQueue(conversationId, { sendingId: item.id, reorderUntil: null })
    try {
      const prepared = await prepareRun({
        ...item.input,
        userId: queue.userId,
        conversationId,
        parentId: queue.parentId,
        queuedMessageId: item.id,
      })
      if (!prepared.ok) {
        updateQueue(conversationId, { sendingId: null, paused: true, error: prepared.message })
        return
      }
      // prepareRun 已在 run 创建事务中移除该项并记录 waitingRunId。
      const accepted = getMessageQueue(conversationId)
      if (!accepted) return
      publish(accepted)
      runManager.start(prepared)
      if (accepted.paused) runManager.abort(prepared.run.id)
    } catch (error) {
      const current = getMessageQueue(conversationId)
      if (!current) return
      cleanupPreparingMessage(current)
      updateQueue(conversationId, {
        sendingId: null,
        paused: true,
        error: '发送失败，待发送的消息已保留，请稍后继续。',
      })
      console.error('队列发送失败：', error)
    }
  }).finally(() => {
    advancing.delete(conversationId)
    // 极快响应可能在本次准备 Promise 退出前就终结，补接这一次交接。
    const queue = getMessageQueue(conversationId)
    if (!queue?.waitingRunId) return
    const run = db
      .select({ state: runs.state })
      .from(runs)
      .where(eq(runs.id, queue.waitingRunId))
      .get()
    if (run && run.state !== 'queued' && run.state !== 'running')
      void advanceMessageQueue(conversationId)
  })
  advancing.set(conversationId, work)
  return work
}

/** 在 recoverInterruptedRuns 之后执行。准备中断保留原项，已发起的 run 不重复发送。 */
export async function recoverMessageQueues(): Promise<void> {
  const queues = db.select().from(messageQueues).all()
  for (const queue of queues) {
    if (queue.sendingId) {
      cleanupPreparingMessage(queue)
      updateQueue(queue.conversationId, {
        sendingId: null,
        paused: true,
        error: '服务已重启，待发送的消息已保留。',
        reorderUntil: null,
      })
    } else {
      db.update(messageQueues)
        .set({ reorderUntil: null })
        .where(eq(messageQueues.conversationId, queue.conversationId))
        .run()
    }
    await advanceMessageQueue(queue.conversationId)
  }
}

export function startMessageQueueRunner(): () => void {
  const unsubscribe = runManager.onSettled((conversationId) => {
    void advanceMessageQueue(conversationId)
  })
  return () => {
    unsubscribe()
    reorderTimers.forEach(clearTimeout)
    reorderTimers.clear()
  }
}
