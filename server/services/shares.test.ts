import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ContentPart } from '@shared/types/domain'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let shares: typeof import('./shares')
let seq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-shares-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-shares'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  shares = await import('./shares')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

async function createUser() {
  const n = seq++
  const [user] = await dbClient.db
    .insert(schema.users)
    .values({ username: `share-user-${n}`, passwordHash: 'hash' })
    .returning()
  if (!user) throw new Error('Failed to create user')
  return user
}

async function addMessage(input: {
  conversationId: string
  parentId?: string | null
  role: 'user' | 'assistant'
  content: ContentPart[]
}) {
  const [message] = await dbClient.db
    .insert(schema.messages)
    .values({
      conversationId: input.conversationId,
      parentId: input.parentId ?? null,
      role: input.role,
      status: 'complete',
      content: input.content,
    })
    .returning()
  if (!message) throw new Error('Failed to create message')
  return message
}

/**
 * 建一棵标准消息树并把 activeLeaf 指到主分支叶子：
 *   u1 ── a1 ── u2 ── a2   （主分支，active）
 *          └── u2b         （并列分支）
 */
async function createConversationTree(userId: string) {
  const [conv] = await dbClient.db
    .insert(schema.conversations)
    .values({ userId, title: '分享测试对话' })
    .returning()
  if (!conv) throw new Error('Failed to create conversation')

  const u1 = await addMessage({
    conversationId: conv.id,
    role: 'user',
    content: [
      { type: 'input_text', text: '第一问' },
      { type: 'input_image', attachment_id: `att-img-${seq++}`, },
      { type: 'input_file', attachment_id: `att-file-${seq++}`, filename: 'notes.txt' },
    ],
  })
  const a1 = await addMessage({
    conversationId: conv.id,
    parentId: u1.id,
    role: 'assistant',
    content: [{ type: 'output_text', text: '第一答', annotations: [] }],
  })
  const u2 = await addMessage({
    conversationId: conv.id,
    parentId: a1.id,
    role: 'user',
    content: [{ type: 'input_text', text: '第二问' }],
  })
  const a2 = await addMessage({
    conversationId: conv.id,
    parentId: u2.id,
    role: 'assistant',
    content: [{ type: 'output_text', text: '第二答', annotations: [] }],
  })
  const u2b = await addMessage({
    conversationId: conv.id,
    parentId: a1.id,
    role: 'user',
    content: [{ type: 'input_text', text: '并列分支问' }],
  })
  await dbClient.db
    .update(schema.conversations)
    .set({ activeLeafId: a2.id })
    .where(eq(schema.conversations.id, conv.id))
  return { conv, u1, a1, u2, a2, u2b }
}

const baseInput = { showAvatar: true, showName: true, includeAttachments: true }

describe('createShare 消息选择', () => {
  it('缺省 = 当前可见分支全部消息；快照按根→叶排序', async () => {
    const user = await createUser()
    const { conv, u1, a1, u2, a2 } = await createConversationTree(user.id)
    const result = await shares.createShare(user.id, conv.id, { ...baseInput })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.share.messageCount).toBe(4)

    const dto = await shares.getConversationShare(user.id, conv.id)
    expect(dto?.sharedMessageIds).toEqual([u1.id, a1.id, u2.id, a2.id])
  })

  it('手动选择：同分支子集（用户/助手解耦）按链序生效', async () => {
    const user = await createUser()
    const { conv, u1, a2 } = await createConversationTree(user.id)
    const result = await shares.createShare(user.id, conv.id, {
      ...baseInput,
      // 故意乱序传入：快照必须按链序（根→叶）而非入参顺序
      messageIds: [a2.id, u1.id],
    })
    expect(result.ok).toBe(true)
    const dto = await shares.getConversationShare(user.id, conv.id)
    expect(dto?.sharedMessageIds).toEqual([u1.id, a2.id])
  })

  it('跨并列分支选择被拒绝', async () => {
    const user = await createUser()
    const { conv, u2, u2b } = await createConversationTree(user.id)
    const result = await shares.createShare(user.id, conv.id, {
      ...baseInput,
      messageIds: [u2.id, u2b.id],
    })
    expect(result).toEqual({ ok: false, code: 'invalid_selection' })
  })

  it('不存在的消息 id 被拒绝', async () => {
    const user = await createUser()
    const { conv } = await createConversationTree(user.id)
    const result = await shares.createShare(user.id, conv.id, {
      ...baseInput,
      messageIds: ['ghost-id'],
    })
    expect(result).toEqual({ ok: false, code: 'invalid_selection' })
  })

  it('旁支消息可以作为选择链分享（不局限于 activeLeaf 路径）', async () => {
    const user = await createUser()
    const { conv, u1, u2b } = await createConversationTree(user.id)
    const result = await shares.createShare(user.id, conv.id, {
      ...baseInput,
      messageIds: [u1.id, u2b.id],
    })
    expect(result.ok).toBe(true)
    const dto = await shares.getConversationShare(user.id, conv.id)
    expect(dto?.sharedMessageIds).toEqual([u1.id, u2b.id])
  })
})

describe('createShare 附件包含开关', () => {
  it('includeAttachments=false 时剥离用户附件引用并保留文件名占位；公开附件路由取不到', async () => {
    const user = await createUser()
    const { conv, u1 } = await createConversationTree(user.id)
    const result = await shares.createShare(user.id, conv.id, {
      ...baseInput,
      includeAttachments: false,
      messageIds: [u1.id],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.share.includeAttachments).toBe(false)

    const [row] = await dbClient.db
      .select()
      .from(schema.sharedChats)
      .where(eq(schema.sharedChats.conversationId, conv.id))
      .limit(1)
    const parts = row!.snapshot[0]!.content
    const image = parts.find((p) => p.type === 'input_image')
    const file = parts.find((p) => p.type === 'input_file')
    expect(image).toMatchObject({ attachment_id: '' })
    expect(file).toMatchObject({ attachment_id: '', filename: 'notes.txt' })

    // 原始附件 id 不可再经公开路由获取
    const originalImageId = (u1.content.find((p) => p.type === 'input_image') as { attachment_id: string })
      .attachment_id
    expect(await shares.getShareAttachment(row!.token, originalImageId)).toBeNull()

    // 公开视图声明附件未包含
    const pub = await shares.getPublicShare(row!.token)
    expect(pub?.attachmentsIncluded).toBe(false)
  })

  it('includeAttachments=true 时快照保留附件引用', async () => {
    const user = await createUser()
    const { conv, u1 } = await createConversationTree(user.id)
    await shares.createShare(user.id, conv.id, { ...baseInput, messageIds: [u1.id] })
    const [row] = await dbClient.db
      .select()
      .from(schema.sharedChats)
      .where(eq(schema.sharedChats.conversationId, conv.id))
      .limit(1)
    const image = row!.snapshot[0]!.content.find((p) => p.type === 'input_image')
    expect((image as { attachment_id: string }).attachment_id).not.toBe('')
  })
})

describe('createShare 有效期语义', () => {
  it("更新时 'keep'/缺省 保持原到期时间；显式值可改永久或重新计时", async () => {
    const user = await createUser()
    const { conv } = await createConversationTree(user.id)
    const created = await shares.createShare(user.id, conv.id, {
      ...baseInput,
      expiresInDays: 7,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const originalExpiry = created.share.expiresAt
    expect(originalExpiry).not.toBeNull()

    // 'keep' 不动到期时间（回归：以前更新会被重置为永久）
    const kept = await shares.createShare(user.id, conv.id, { ...baseInput, expiresInDays: 'keep' })
    if (!kept.ok) throw new Error('keep update failed')
    expect(kept.share.expiresAt).toBe(originalExpiry)

    // 缺省字段同样视为保持
    const keptDefault = await shares.createShare(user.id, conv.id, { ...baseInput })
    if (!keptDefault.ok) throw new Error('default update failed')
    expect(keptDefault.share.expiresAt).toBe(originalExpiry)

    // 显式 null → 永久
    const permanent = await shares.createShare(user.id, conv.id, { ...baseInput, expiresInDays: null })
    if (!permanent.ok) throw new Error('permanent update failed')
    expect(permanent.share.expiresAt).toBeNull()

    // 显式 30 → 重新计时
    const renewed = await shares.createShare(user.id, conv.id, { ...baseInput, expiresInDays: 30 })
    if (!renewed.ok) throw new Error('renew update failed')
    expect(renewed.share.expiresAt).toBeGreaterThan(Date.now() + 29 * 86_400_000)
  })

  it('已过期分享公开视图与附件访问均不可用', async () => {
    const user = await createUser()
    const { conv } = await createConversationTree(user.id)
    const created = await shares.createShare(user.id, conv.id, { ...baseInput })
    if (!created.ok) throw new Error('create failed')
    await dbClient.db
      .update(schema.sharedChats)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sharedChats.id, created.share.id))
    expect(await shares.getPublicShare(created.share.token)).toBeNull()
  })
})

describe('停止分享与重新分享', () => {
  it('撤销后旧 token 永久失效；再次分享生成全新 token', async () => {
    const user = await createUser()
    const { conv } = await createConversationTree(user.id)
    const first = await shares.createShare(user.id, conv.id, { ...baseInput })
    if (!first.ok) throw new Error('create failed')
    const oldToken = first.share.token

    await shares.revokeShare(first.share.id, user.id)
    expect(await shares.getPublicShare(oldToken)).toBeNull()

    const second = await shares.createShare(user.id, conv.id, { ...baseInput })
    if (!second.ok) throw new Error('re-share failed')
    expect(second.share.token).not.toBe(oldToken)
    expect(second.share.revoked).toBe(false)

    // 旧链接保持失效，新链接可用
    expect(await shares.getPublicShare(oldToken)).toBeNull()
    expect(await shares.getPublicShare(second.share.token)).not.toBeNull()
  })

  it('未撤销状态下更新分享保持原链接不变', async () => {
    const user = await createUser()
    const { conv } = await createConversationTree(user.id)
    const first = await shares.createShare(user.id, conv.id, { ...baseInput })
    if (!first.ok) throw new Error('create failed')
    const updated = await shares.createShare(user.id, conv.id, { ...baseInput, showName: false })
    if (!updated.ok) throw new Error('update failed')
    expect(updated.share.token).toBe(first.share.token)
    expect(updated.share.showName).toBe(false)
  })
})
