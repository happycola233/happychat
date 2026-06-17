import { and, asc, desc, eq } from 'drizzle-orm'
import type { ConversationDTO, MessageDTO } from '@shared/types/api'
import { db } from '../db/client'
import { conversations, messages } from '../db/schema'

export type ConvRow = typeof conversations.$inferSelect
export type MsgRow = typeof messages.$inferSelect

export function toConversationDTO(c: ConvRow): ConversationDTO {
  return {
    id: c.id,
    title: c.title,
    modelId: c.modelId,
    activeLeafId: c.activeLeafId,
    createdAt: c.createdAt.getTime(),
    updatedAt: c.updatedAt.getTime(),
  }
}

export function toMessageDTO(m: MsgRow): MessageDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    parentId: m.parentId,
    role: m.role,
    status: m.status,
    content: m.content,
    modelId: m.modelId,
    runId: m.runId,
    reasoningSummary: m.reasoningSummary,
    annotations: m.annotations,
    usage:
      m.totalTokens != null
        ? {
            inputTokens: m.inputTokens ?? 0,
            cachedTokens: m.cachedTokens ?? 0,
            outputTokens: m.outputTokens ?? 0,
            reasoningTokens: m.reasoningTokens ?? 0,
            totalTokens: m.totalTokens,
          }
        : null,
    errorMessage: m.errorMessage,
    createdAt: m.createdAt.getTime(),
  }
}

export async function listConversations(userId: string): Promise<ConversationDTO[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.archived, false)))
    .orderBy(desc(conversations.updatedAt))
  return rows.map(toConversationDTO)
}

export async function getOwnedConversation(
  userId: string,
  id: string,
): Promise<ConvRow | null> {
  const [c] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1)
  return c ?? null
}

export async function getConversationMessages(conversationId: string): Promise<MsgRow[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
}

/** 从某节点向下，每层选最新的子节点，定位到最深叶子（用于分支切换）。 */
export function deepestLeaf(all: MsgRow[], startId: string): string {
  const childrenByParent = new Map<string, MsgRow[]>()
  for (const m of all) {
    if (!m.parentId) continue
    const arr = childrenByParent.get(m.parentId) ?? []
    arr.push(m)
    childrenByParent.set(m.parentId, arr)
  }
  let cur = startId
  const guard = new Set<string>()
  while (!guard.has(cur)) {
    guard.add(cur)
    const kids = childrenByParent.get(cur)
    if (!kids || kids.length === 0) break
    kids.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    cur = kids[kids.length - 1]!.id
  }
  return cur
}

/** 从 leaf 沿 parentId 向上构建可见路径（根 → 叶）。 */
export function buildPath(all: MsgRow[], leafId: string | null): MsgRow[] {
  if (!leafId) return []
  const byId = new Map(all.map((m) => [m.id, m]))
  const path: MsgRow[] = []
  const guard = new Set<string>()
  let cur = byId.get(leafId)
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    path.push(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return path.reverse()
}
