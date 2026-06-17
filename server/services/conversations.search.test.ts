import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let services: typeof import('./conversations')
let seq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-conversations-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-conversations'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  services = await import('./conversations')
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
    .values({ username: `user-${n}`, passwordHash: 'hash' })
    .returning()
  if (!user) throw new Error('Failed to create user')
  return user
}

async function createConversation(userId: string, title: string | null, archived = false) {
  const [conversation] = await dbClient.db
    .insert(schema.conversations)
    .values({ userId, title, archived })
    .returning()
  if (!conversation) throw new Error('Failed to create conversation')
  return conversation
}

async function addMessage({
  conversationId,
  role,
  text,
  parentId = null,
}: {
  conversationId: string
  role: 'user' | 'assistant'
  text: string
  parentId?: string | null
}) {
  const [message] = await dbClient.db
    .insert(schema.messages)
    .values({
      conversationId,
      parentId,
      role,
      status: 'complete',
      content:
        role === 'user'
          ? [{ type: 'input_text', text }]
          : [{ type: 'output_text', text, annotations: [] }],
    })
    .returning()
  if (!message) throw new Error('Failed to create message')
  return message
}

async function setActiveLeaf(conversationId: string, messageId: string) {
  await dbClient.db
    .update(schema.conversations)
    .set({ activeLeafId: messageId })
    .where(eq(schema.conversations.id, conversationId))
}

describe('conversation pinning and search', () => {
  it('pins and unpins conversations without changing their recency timestamp', async () => {
    const user = await createUser()
    const first = await createConversation(user.id, 'first')
    const second = await createConversation(user.id, 'second')
    const beforeUpdatedAt = first.updatedAt.getTime()

    const pinned = await services.setConversationPinned(user.id, first.id, true)
    expect(pinned?.pinnedAt).toEqual(expect.any(Number))

    const afterPin = await services.getOwnedConversation(user.id, first.id)
    expect(afterPin?.updatedAt.getTime()).toBe(beforeUpdatedAt)

    const listed = await services.listConversations(user.id)
    expect(listed.map((conversation) => conversation.id).slice(0, 2)).toEqual([
      first.id,
      second.id,
    ])

    const unpinned = await services.setConversationPinned(user.id, first.id, false)
    expect(unpinned?.pinnedAt).toBeNull()
  })

  it('searches titles plus visible input and output text only', async () => {
    const owner = await createUser()
    const other = await createUser()
    const conversation = await createConversation(owner.id, 'Title Needle')
    const root = await addMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'visible input needle',
    })
    const assistant = await addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      text: 'visible output needle',
      parentId: root.id,
    })
    await addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      text: 'hidden branch needle',
      parentId: root.id,
    })
    await setActiveLeaf(conversation.id, assistant.id)

    const imageOnly = await createConversation(owner.id, 'plain image chat')
    const [imageMessage] = await dbClient.db
      .insert(schema.messages)
      .values({
        conversationId: imageOnly.id,
        role: 'user',
        status: 'complete',
        content: [{ type: 'input_image', attachment_id: 'image-only-needle' }],
      })
      .returning()
    if (!imageMessage) throw new Error('Failed to create image message')
    await setActiveLeaf(imageOnly.id, imageMessage.id)

    const archived = await createConversation(owner.id, 'archived needle', true)
    const archivedMessage = await addMessage({
      conversationId: archived.id,
      role: 'user',
      text: 'archived content needle',
    })
    await setActiveLeaf(archived.id, archivedMessage.id)

    const otherConversation = await createConversation(other.id, 'other needle')
    const otherMessage = await addMessage({
      conversationId: otherConversation.id,
      role: 'assistant',
      text: 'other output needle',
    })
    await setActiveLeaf(otherConversation.id, otherMessage.id)

    const titleResults = await services.searchConversations(owner.id, 'title needle')
    expect(titleResults[0]).toMatchObject({
      conversation: { id: conversation.id },
      matchType: 'title',
      role: null,
    })

    const inputResults = await services.searchConversations(owner.id, 'visible input')
    expect(inputResults[0]).toMatchObject({
      conversation: { id: conversation.id },
      messageId: root.id,
      role: 'user',
    })

    const outputResults = await services.searchConversations(owner.id, 'visible output')
    expect(outputResults[0]).toMatchObject({
      conversation: { id: conversation.id },
      messageId: assistant.id,
      role: 'assistant',
    })

    expect(await services.searchConversations(owner.id, 'hidden branch')).toHaveLength(0)
    expect(await services.searchConversations(owner.id, 'image-only-needle')).toHaveLength(0)
    expect(await services.searchConversations(owner.id, 'archived needle')).toHaveLength(0)
    expect(await services.searchConversations(owner.id, 'other needle')).toHaveLength(0)
  })
})
