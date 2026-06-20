import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { eq } from 'drizzle-orm'
import { CONVERSATION_EVENT_TYPE } from '@shared/types/events'
import {
  pinConversationSchema,
  renameConversationSchema,
  switchBranchSchema,
} from '@shared/schemas/chat'
import { createShareSchema } from '@shared/schemas/share'
import { db } from '../db/client'
import { conversations } from '../db/schema'
import { requireUser } from '../auth/middleware'
import { jsonValidator } from '../http/validator'
import {
  clearAllConversations,
  deepestLeaf,
  getConversationLastRun,
  getConversationMessageDTOs,
  getConversationMessages,
  getOwnedConversation,
  listConversations,
  searchConversations,
  setConversationPinned,
  toConversationDTO,
} from '../services/conversations'
import {
  canUserShare,
  createShare,
  getConversationShare,
  listOwnerShares,
  revokeShare,
} from '../services/shares'
import { conversationEvents, type ConversationEvent } from '../services/conversation-events'
import type { AppEnv } from '../http/types'

export const conversationRoutes = new Hono<AppEnv>()

conversationRoutes.use('*', requireUser)

conversationRoutes.get('/', async (c) => {
  return c.json({ conversations: await listConversations(c.get('user').id) })
})

/** 清空当前用户的全部对话 */
conversationRoutes.delete('/', async (c) => {
  const deletedCount = await clearAllConversations(c.get('user').id)
  return c.json({ deletedCount })
})

conversationRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 200)
  return c.json({ results: await searchConversations(c.get('user').id, q) })
})

/** 我的分享列表（字面量路由，须在 /:id 之前注册）。 */
conversationRoutes.get('/shared', async (c) => {
  return c.json({ shares: await listOwnerShares(c.get('user').id) })
})

/** 用户级会话事件流：标题自动总结完成后实时通知前端刷新缓存。 */
conversationRoutes.get('/events', async (c) => {
  const userId = c.get('user').id
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')
  c.header('Connection', 'keep-alive')

  return streamSSE(
    c,
    async (stream) => {
      const queue: ConversationEvent[] = []
      let waiter: (() => void) | null = null
      let aborted = false

      const onEvent = (event: ConversationEvent) => {
        queue.push(event)
        const wake = waiter
        waiter = null
        wake?.()
      }
      const unsubscribe = conversationEvents.subscribe(userId, onEvent)
      stream.onAbort(() => {
        aborted = true
        const wake = waiter
        waiter = null
        wake?.()
      })

      const writeEvent = (event: Pick<ConversationEvent, 'type' | 'sequenceNumber' | 'data'>) =>
        stream.writeSSE({
          id: String(event.sequenceNumber),
          data: JSON.stringify({ type: event.type, seq: event.sequenceNumber, data: event.data }),
        })

      const waitNext = () =>
        new Promise<void>((resolve) => {
          if (queue.length > 0 || aborted) {
            resolve()
            return
          }
          waiter = resolve
        })

      try {
        await writeEvent({
          type: CONVERSATION_EVENT_TYPE.ready,
          sequenceNumber: -1,
          data: {},
        })
        while (!aborted) {
          await waitNext()
          while (!aborted && queue.length > 0) {
            await writeEvent(queue.shift()!)
          }
        }
      } finally {
        unsubscribe()
      }
    },
    async () => {
      // 客户端离开页面或刷新造成的写入异常无需打断服务端。
    },
  )
})

conversationRoutes.get('/:id', async (c) => {
  const conv = await getOwnedConversation(c.get('user').id, c.req.param('id'))
  if (!conv) return c.json({ error: { message: '会话不存在', code: 'not_found' } }, 404)
  const messages = await getConversationMessageDTOs(conv.id)
  const lastRun = await getConversationLastRun(conv.id)
  return c.json({
    conversation: toConversationDTO(conv),
    messages,
    lastModelId: lastRun.modelId,
    lastParams: lastRun.params,
  })
})

conversationRoutes.patch('/:id', jsonValidator(renameConversationSchema), async (c) => {
  const conv = await getOwnedConversation(c.get('user').id, c.req.param('id'))
  if (!conv) return c.json({ error: { message: '会话不存在', code: 'not_found' } }, 404)
  await db
    .update(conversations)
    .set({ title: c.req.valid('json').title })
    .where(eq(conversations.id, conv.id))
  return c.json({ ok: true })
})

conversationRoutes.patch('/:id/pin', jsonValidator(pinConversationSchema), async (c) => {
  const updated = await setConversationPinned(
    c.get('user').id,
    c.req.param('id'),
    c.req.valid('json').pinned,
  )
  if (!updated) return c.json({ error: { message: '会话不存在', code: 'not_found' } }, 404)
  return c.json({ conversation: updated })
})

/** 切换分支：把可见路径切到目标消息所在分支（取其最深叶子）。 */
conversationRoutes.post('/:id/switch', jsonValidator(switchBranchSchema), async (c) => {
  const conv = await getOwnedConversation(c.get('user').id, c.req.param('id'))
  if (!conv) return c.json({ error: { message: '会话不存在', code: 'not_found' } }, 404)
  const { messageId } = c.req.valid('json')
  const all = await getConversationMessages(conv.id)
  if (!all.some((m) => m.id === messageId)) {
    return c.json({ error: { message: '消息不存在', code: 'not_found' } }, 404)
  }
  const leaf = deepestLeaf(all, messageId)
  await db.update(conversations).set({ activeLeafId: leaf }).where(eq(conversations.id, conv.id))
  return c.json({ activeLeafId: leaf })
})

conversationRoutes.delete('/:id', async (c) => {
  const conv = await getOwnedConversation(c.get('user').id, c.req.param('id'))
  if (!conv) return c.json({ error: { message: '会话不存在', code: 'not_found' } }, 404)
  await db.delete(conversations).where(eq(conversations.id, conv.id))
  return c.json({ ok: true })
})

// ---------------- 分享 ----------------

conversationRoutes.post('/:id/share', jsonValidator(createShareSchema), async (c) => {
  const user = c.get('user')
  if (!(await canUserShare(user))) {
    return c.json({ error: { message: '分享功能已被管理员关闭', code: 'sharing_disabled' } }, 403)
  }
  const result = await createShare(user.id, c.req.param('id'), c.req.valid('json'))
  if (!result.ok) return c.json({ error: { message: '会话不存在', code: 'not_found' } }, 404)
  return c.json({ share: result.share })
})

conversationRoutes.get('/:id/share', async (c) => {
  return c.json({ share: await getConversationShare(c.get('user').id, c.req.param('id')) })
})

conversationRoutes.delete('/:id/share', async (c) => {
  const share = await getConversationShare(c.get('user').id, c.req.param('id'))
  if (share) await revokeShare(share.id, c.get('user').id)
  return c.json({ ok: true })
})
