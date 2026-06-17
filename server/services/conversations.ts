import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { ConversationDTO, ConversationSearchResultDTO, MessageDTO } from '@shared/types/api'
import { textFromContent } from '@shared/util/contentText'
import { db } from '../db/client'
import { conversations, messages, runEvents } from '../db/schema'
import { computeReasoningDurationMs, type ReasoningTimingEvent } from './reasoning-timing'

export type ConvRow = typeof conversations.$inferSelect
export type MsgRow = typeof messages.$inferSelect

export function toConversationDTO(c: ConvRow): ConversationDTO {
  return {
    id: c.id,
    title: c.title,
    modelId: c.modelId,
    activeLeafId: c.activeLeafId,
    pinnedAt: c.pinnedAt?.getTime() ?? null,
    createdAt: c.createdAt.getTime(),
    updatedAt: c.updatedAt.getTime(),
  }
}

export function toMessageDTO(m: MsgRow, reasoningDurationMs: number | null = null): MessageDTO {
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
    reasoningDurationMs,
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
    .orderBy(desc(conversations.pinnedAt), desc(conversations.updatedAt))
  return rows.map(toConversationDTO)
}

export async function getOwnedConversation(userId: string, id: string): Promise<ConvRow | null> {
  const [c] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1)
  return c ?? null
}

export async function setConversationPinned(
  userId: string,
  id: string,
  pinned: boolean,
): Promise<ConversationDTO | null> {
  const conv = await getOwnedConversation(userId, id)
  if (!conv) return null
  const [updated] = await db
    .update(conversations)
    .set({ pinnedAt: pinned ? new Date() : null, updatedAt: conv.updatedAt })
    .where(eq(conversations.id, conv.id))
    .returning()
  return updated ? toConversationDTO(updated) : null
}

export async function getConversationMessages(conversationId: string): Promise<MsgRow[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
}

async function getReasoningDurationByMessageId(rows: MsgRow[]): Promise<Map<string, number>> {
  const runIds = rows.map((m) => m.runId).filter((runId): runId is string => Boolean(runId))
  if (runIds.length === 0) return new Map()

  const eventRows = await db
    .select({
      runId: runEvents.runId,
      type: runEvents.type,
      sequenceNumber: runEvents.sequenceNumber,
      createdAt: runEvents.createdAt,
    })
    .from(runEvents)
    .where(inArray(runEvents.runId, [...new Set(runIds)]))
    .orderBy(asc(runEvents.runId), asc(runEvents.sequenceNumber))

  const byRun = new Map<string, ReasoningTimingEvent[]>()
  for (const ev of eventRows) {
    const items = byRun.get(ev.runId) ?? []
    items.push(ev)
    byRun.set(ev.runId, items)
  }

  const durations = new Map<string, number>()
  for (const m of rows) {
    if (!m.runId) continue
    const duration = computeReasoningDurationMs(byRun.get(m.runId) ?? [])
    if (duration !== null) durations.set(m.id, duration)
  }
  return durations
}

export async function getConversationMessageDTOs(conversationId: string): Promise<MessageDTO[]> {
  const rows = await getConversationMessages(conversationId)
  const durations = await getReasoningDurationByMessageId(rows)
  return rows.map((m) => toMessageDTO(m, durations.get(m.id) ?? null))
}

function makeSnippet(text: string, query: string, maxLength = 112): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLength) return clean
  const idx = clean.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (idx === -1) return `${clean.slice(0, maxLength).trimEnd()}...`
  const side = Math.max(12, Math.floor((maxLength - query.length) / 2))
  const start = Math.max(0, idx - side)
  const end = Math.min(clean.length, start + maxLength)
  return `${start > 0 ? '...' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '...' : ''}`
}

export async function searchConversations(
  userId: string,
  query: string,
  limit = 50,
): Promise<ConversationSearchResultDTO[]> {
  const q = query.trim()
  if (!q) return []

  const convRows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.archived, false)))
    .orderBy(desc(conversations.pinnedAt), desc(conversations.updatedAt))

  if (convRows.length === 0) return []

  const msgRows = await db
    .select()
    .from(messages)
    .where(inArray(messages.conversationId, convRows.map((c) => c.id)))
    .orderBy(asc(messages.createdAt))

  const byConversation = new Map<string, MsgRow[]>()
  for (const msg of msgRows) {
    const items = byConversation.get(msg.conversationId) ?? []
    items.push(msg)
    byConversation.set(msg.conversationId, items)
  }

  const needle = q.toLocaleLowerCase()
  const results: ConversationSearchResultDTO[] = []
  for (const conv of convRows) {
    const title = conv.title ?? '新聊天'
    if (title.toLocaleLowerCase().includes(needle)) {
      results.push({
        conversation: toConversationDTO(conv),
        messageId: null,
        matchType: 'title',
        role: null,
        snippet: makeSnippet(title, q),
      })
    } else {
      const path = buildPath(byConversation.get(conv.id) ?? [], conv.activeLeafId)
      const hit = path.find((msg) => textFromContent(msg.content).toLocaleLowerCase().includes(needle))
      if (hit) {
        results.push({
          conversation: toConversationDTO(conv),
          messageId: hit.id,
          matchType: 'message',
          role: hit.role,
          snippet: makeSnippet(textFromContent(hit.content), q),
        })
      }
    }
    if (results.length >= limit) break
  }

  return results
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
