import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { ConversationDTO, ConversationSearchResultDTO, MessageDTO } from '@shared/types/api'
import type { ModelParams, ReasoningEffort } from '@shared/types/domain'
import { textFromContent } from '@shared/util/contentText'
import { effectiveReasoningEffort, isReasoningEnabled } from '@shared/util/reasoning'
import { effectiveWebSearchEnabled } from '@shared/util/webSearch'
import { db } from '../db/client'
import { attachments, conversations, messages, models, runEvents, runs } from '../db/schema'
import { removeUpload } from '../storage/files'
import { computeReasoningDurationMs, type ReasoningTimingEvent } from './reasoning-timing'
import { computeGenerationDurationMs } from './run-timing'

export type ConvRow = typeof conversations.$inferSelect
export type MsgRow = typeof messages.$inferSelect

/** 消息的读取期计时（不入库，按 run 数据现算）。 */
export interface MessageTiming {
  reasoningDurationMs: number | null
  generationDurationMs: number | null
}

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

export function toMessageDTO(
  m: MsgRow,
  timing: MessageTiming | null = null,
  modelLabel: string | null = null,
): MessageDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    parentId: m.parentId,
    role: m.role,
    status: m.status,
    content: m.content,
    modelId: m.modelId,
    modelLabel,
    runId: m.runId,
    reasoningSummary: m.reasoningSummary,
    reasoningDurationMs: timing?.reasoningDurationMs ?? null,
    generationDurationMs: timing?.generationDurationMs ?? null,
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

async function getMessageTimingByMessageId(rows: MsgRow[]): Promise<Map<string, MessageTiming>> {
  const runIds = rows.map((m) => m.runId).filter((runId): runId is string => Boolean(runId))
  if (runIds.length === 0) return new Map()
  const uniqueRunIds = [...new Set(runIds)]

  const runRows = await db
    .select({
      runId: runs.id,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      requestParams: runs.requestParams,
      modelKind: models.kind,
      modelCapabilities: models.capabilities,
      modelDefaultParams: models.defaultParams,
      modelDefaultEffort: models.defaultEffort,
    })
    .from(runs)
    .leftJoin(models, eq(runs.modelId, models.id))
    .where(inArray(runs.id, uniqueRunIds))

  // 整次生成墙钟耗时（所有 run，不限推理）：finishedAt − startedAt。
  const generationByRun = new Map<string, number>()
  for (const row of runRows) {
    const durationMs = computeGenerationDurationMs(row.startedAt, row.finishedAt)
    if (durationMs !== null) generationByRun.set(row.runId, durationMs)
  }

  // 推理耗时（仅推理 run，需要回放 run_events）。
  const reasoningRunIds = new Set(
    runRows
      .filter((row) =>
        isReasoningEnabled(
          row.modelCapabilities
            ? {
                kind: row.modelKind ?? undefined,
                capabilities: row.modelCapabilities,
                defaultParams: row.modelDefaultParams,
                defaultEffort: row.modelDefaultEffort,
              }
            : null,
          row.requestParams as ModelParams | null,
        ),
      )
      .map((row) => row.runId),
  )

  const reasoningByRun = new Map<string, number>()
  if (reasoningRunIds.size > 0) {
    const eventRows = await db
      .select({
        runId: runEvents.runId,
        type: runEvents.type,
        sequenceNumber: runEvents.sequenceNumber,
        createdAt: runEvents.createdAt,
      })
      .from(runEvents)
      .where(inArray(runEvents.runId, [...reasoningRunIds]))
      .orderBy(asc(runEvents.runId), asc(runEvents.sequenceNumber))

    const byRun = new Map<string, ReasoningTimingEvent[]>()
    for (const ev of eventRows) {
      const items = byRun.get(ev.runId) ?? []
      items.push(ev)
      byRun.set(ev.runId, items)
    }
    for (const runId of reasoningRunIds) {
      const duration = computeReasoningDurationMs(byRun.get(runId) ?? [])
      if (duration !== null) reasoningByRun.set(runId, duration)
    }
  }

  const timings = new Map<string, MessageTiming>()
  for (const m of rows) {
    if (!m.runId) continue
    timings.set(m.id, {
      reasoningDurationMs: reasoningByRun.get(m.runId) ?? null,
      generationDurationMs: generationByRun.get(m.runId) ?? null,
    })
  }
  return timings
}

async function getModelLabelsByModelId(rows: MsgRow[]): Promise<Map<string, string>> {
  const modelIds = rows.map((m) => m.modelId).filter((id): id is string => Boolean(id))
  if (modelIds.length === 0) return new Map()
  const uniqueModelIds = [...new Set(modelIds)]
  const modelRows = await db
    .select({ id: models.id, modelId: models.modelId, displayName: models.displayName })
    .from(models)
    .where(inArray(models.id, uniqueModelIds))

  return new Map(modelRows.map((m) => [m.id, m.displayName || m.modelId]))
}

export async function getConversationMessageDTOs(conversationId: string): Promise<MessageDTO[]> {
  const rows = await getConversationMessages(conversationId)
  const [timings, modelLabels] = await Promise.all([
    getMessageTimingByMessageId(rows),
    getModelLabelsByModelId(rows),
  ])
  return rows.map((m) =>
    toMessageDTO(m, timings.get(m.id) ?? null, m.modelId ? (modelLabels.get(m.modelId) ?? null) : null),
  )
}

/** 会话最近一次生成所用的模型与联网/思考参数（用于打开会话时恢复控件）。 */
export async function getConversationLastRun(
  conversationId: string,
): Promise<{
  modelId: string | null
  params: { web_search?: boolean; reasoning_effort?: ReasoningEffort } | null
}> {
  const [r] = await db
    .select({
      modelId: runs.modelId,
      requestParams: runs.requestParams,
      modelKind: models.kind,
      modelCapabilities: models.capabilities,
      modelDefaultParams: models.defaultParams,
      modelDefaultEffort: models.defaultEffort,
      modelDefaultWebSearch: models.defaultWebSearch,
    })
    .from(runs)
    .leftJoin(models, eq(runs.modelId, models.id))
    .where(eq(runs.conversationId, conversationId))
    .orderBy(desc(runs.createdAt))
    .limit(1)
  if (!r) return { modelId: null, params: null }
  const rp = (r.requestParams ?? {}) as ModelParams
  const params: { web_search?: boolean; reasoning_effort?: ReasoningEffort } = {}

  if (r.modelCapabilities) {
    const modelConfig = {
      kind: r.modelKind ?? undefined,
      capabilities: r.modelCapabilities,
      defaultParams: r.modelDefaultParams,
      defaultEffort: r.modelDefaultEffort,
      defaultWebSearch: r.modelDefaultWebSearch,
    }
    if (r.modelCapabilities.web_search) params.web_search = effectiveWebSearchEnabled(modelConfig, rp)
    const effort = effectiveReasoningEffort(modelConfig, rp)
    if (effort) params.reasoning_effort = effort
  } else {
    if (rp.web_search !== undefined) params.web_search = rp.web_search
    if (rp.reasoning_effort !== undefined) params.reasoning_effort = rp.reasoning_effort
  }

  return {
    modelId: r.modelId,
    params: Object.keys(params).length ? params : null,
  }
}

/**
 * 清空某用户的全部对话（级联删除 messages/runs/run_events），
 * 并删除其全部附件（行 + 磁盘文件；头像存于 users.avatarPath，不受影响）。
 * 返回被删除的会话数。
 */
export async function clearAllConversations(userId: string): Promise<number> {
  const convRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))

  const attachmentRows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.userId, userId))

  await db.delete(conversations).where(eq(conversations.userId, userId))

  if (attachmentRows.length > 0) {
    await db.delete(attachments).where(eq(attachments.userId, userId))
    for (const a of attachmentRows) removeUpload(a.storagePath)
  }

  return convRows.length
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
