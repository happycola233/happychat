import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
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
