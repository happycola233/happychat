import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { renameConversationSchema, switchBranchSchema } from '@shared/schemas/chat'
import { db } from '../db/client'
import { conversations } from '../db/schema'
import { requireUser } from '../auth/middleware'
import { jsonValidator } from '../http/validator'
import {
  deepestLeaf,
  getConversationMessageDTOs,
  getConversationMessages,
  getOwnedConversation,
  listConversations,
  toConversationDTO,
} from '../services/conversations'
import type { AppEnv } from '../http/types'

export const conversationRoutes = new Hono<AppEnv>()

conversationRoutes.use('*', requireUser)

conversationRoutes.get('/', async (c) => {
  return c.json({ conversations: await listConversations(c.get('user').id) })
})

conversationRoutes.get('/:id', async (c) => {
  const conv = await getOwnedConversation(c.get('user').id, c.req.param('id'))
  if (!conv) return c.json({ error: { message: '会话不存在', code: 'not_found' } }, 404)
  const messages = await getConversationMessageDTOs(conv.id)
  return c.json({ conversation: toConversationDTO(conv), messages })
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
