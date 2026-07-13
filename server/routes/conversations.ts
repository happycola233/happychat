import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { eq } from 'drizzle-orm'
import { CONVERSATION_EVENT_TYPE } from '@shared/types/events'
import {
  batchDeleteConversationsSchema,
  createConversationBranchSchema,
  moveConversationsSchema,
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
  deleteConversations,
  getConversationLastRun,
  getConversationMessageDTOs,
  getConversationMessages,
  getOwnedConversation,
  listConversations,
  moveConversationsToFolder,
  searchConversations,
  setConversationPinned,
  toConversationDTO,
} from '../services/conversations'
import { getOwnedFolder } from '../services/folders'
import {
  canUserShare,
  createShare,
  getConversationShare,
  listOwnerShares,
  revokeShare,
} from '../services/shares'
import { createConversationBranch } from '../services/conversation-branches'
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

/** 批量删除会话（含附件清理；字面量路由，须在 /:id 之前注册）。 */
conversationRoutes.post(
  '/batch-delete',
  jsonValidator(batchDeleteConversationsSchema),
  async (c) => {
    const deletedCount = await deleteConversations(c.get('user').id, c.req.valid('json').ids)
    return c.json({ deletedCount })
  },
)

/** 批量移动会话到文件夹；folderId=null 表示移出文件夹。 */
conversationRoutes.post('/batch-move', jsonValidator(moveConversationsSchema), async (c) => {
  const { ids, folderId } = c.req.valid('json')
  if (folderId !== null && !(await getOwnedFolder(c.get('user').id, folderId))) {
    return c.json({ error: { message: '文件夹不存在', code: 'not_found' } }, 404)
  }
  const movedCount = await moveConversationsToFolder(c.get('user').id, ids, folderId)
  return c.json({ movedCount })
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

/** 以指定助手消息为终点，创建一份可独立续聊的会话分支副本。 */
conversationRoutes.post('/:id/branch', jsonValidator(createConversationBranchSchema), async (c) => {
  const userId = c.get('user').id
  const result = await createConversationBranch(
    userId,
    c.req.param('id'),
    c.req.valid('json').assistantMessageId,
  )
  if (!result.ok) {
    return c.json({ error: { message: result.message, code: result.code } }, result.status)
  }

  const conversation = await getOwnedConversation(userId, result.conversationId)
  if (!conversation) throw new Error('新分支会话创建后无法读取')
  const [branchMessages, lastRun] = await Promise.all([
    getConversationMessageDTOs(conversation.id),
    getConversationLastRun(conversation.id),
  ])
  return c.json(
    {
      conversation: toConversationDTO(conversation),
      messages: branchMessages,
      lastModelId: lastRun.modelId,
      lastParams: lastRun.params,
    },
    201,
  )
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
  // 与批量删除共用服务（级联消息/runs + 清理附件行与磁盘文件）。
  const deletedCount = await deleteConversations(c.get('user').id, [c.req.param('id')])
  if (deletedCount === 0) {
    return c.json({ error: { message: '会话不存在', code: 'not_found' } }, 404)
  }
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
