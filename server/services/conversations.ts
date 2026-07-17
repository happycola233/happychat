import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { ConversationDTO, ConversationSearchResultDTO, MessageDTO } from '@shared/types/api'
import type { ModelParams, ReasoningEffort } from '@shared/types/domain'
import { textFromContent } from '@shared/util/contentText'
import { effectiveReasoningEffort, isReasoningEnabled } from '@shared/util/reasoning'
import { effectiveWebSearchEnabled } from '@shared/util/webSearch'
import { db } from '../db/client'
import { attachments, conversations, messages, models, runEvents, runs } from '../db/schema'
import { removeUpload } from '../storage/files'
import {
  computeReasoningDurationMs,
  REASONING_TIMING_EVENT_TYPES,
  type ReasoningTimingEvent,
} from './reasoning-timing'
import { computeGenerationDurationMs } from './run-timing'

export type ConvRow = typeof conversations.$inferSelect
export type MsgRow = typeof messages.$inferSelect

/** 消息展示计时：优先使用仍存在的 run 数据，独立分支等场景回退到消息快照。 */
export interface MessageTiming {
  reasoningDurationMs: number | null
  generationDurationMs: number | null
}

export function toConversationDTO(c: ConvRow): ConversationDTO {
  return {
    id: c.id,
    title: c.title,
    modelId: c.modelId,
    folderId: c.folderId,
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
    reasoningDurationMs: timing?.reasoningDurationMs ?? m.reasoningDurationMs ?? null,
    generationDurationMs: timing?.generationDurationMs ?? m.generationDurationMs ?? null,
    annotations: m.annotations,
    usage:
      m.totalTokens != null
        ? {
            inputTokens: m.inputTokens ?? 0,
            cacheWriteTokens: m.cacheWriteTokens ?? 0,
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

/**
 * 批量移动会话到文件夹（folderId=null 表示移出）。只处理属于该用户的会话；
 * 逐行保留 updatedAt 原值，避免整批会话跳到「最近」顶部。返回实际移动数。
 */
export async function moveConversationsToFolder(
  userId: string,
  ids: string[],
  folderId: string | null,
): Promise<number> {
  const owned = await db
    .select({ id: conversations.id, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.userId, userId), inArray(conversations.id, ids)))
  if (owned.length === 0) return 0
  db.transaction((tx) => {
    for (const c of owned) {
      tx.update(conversations)
        .set({ folderId, updatedAt: c.updatedAt })
        .where(eq(conversations.id, c.id))
        .run()
    }
  })
  return owned.length
}

/** inArray 参数分块，避免逼近 SQLite 变量上限。 */
function chunked<T>(items: T[], size = 500): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * 批量删除会话（messages/runs/run_events 由外键级联），并清理这些会话消息
 * 关联的附件（行 + 磁盘文件）。单条删除也走这里，保证清理行为一致。
 * 返回实际删除的会话数。
 */
export async function deleteConversations(userId: string, ids: string[]): Promise<number> {
  const { ownedIds, attachmentRows } = db.transaction(
    (tx) => {
      const owned = tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.userId, userId), inArray(conversations.id, ids)))
        .all()
      if (owned.length === 0) {
        return { ownedIds: [], attachmentRows: [] as (typeof attachments.$inferSelect)[] }
      }
      const ownedIds = owned.map((conversation) => conversation.id)

      // 快照、会话删除和附件行删除必须原子，避免后台历史引用修复穿过删除窗口。
      const msgRows = tx
        .select({ id: messages.id })
        .from(messages)
        .where(inArray(messages.conversationId, ownedIds))
        .all()
      const attachmentRows: (typeof attachments.$inferSelect)[] = []
      for (const chunk of chunked(msgRows.map((message) => message.id))) {
        attachmentRows.push(
          ...tx.select().from(attachments).where(inArray(attachments.messageId, chunk)).all(),
        )
      }

      tx.delete(conversations).where(inArray(conversations.id, ownedIds)).run()
      for (const chunk of chunked(attachmentRows.map((attachment) => attachment.id))) {
        tx.delete(attachments).where(inArray(attachments.id, chunk)).run()
      }
      return { ownedIds, attachmentRows }
    },
    { behavior: 'immediate' },
  )

  for (const attachment of attachmentRows) removeUpload(attachment.storagePath)
  return ownedIds.length
}

export async function getConversationMessages(conversationId: string): Promise<MsgRow[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
}

export async function getMessageTimingByMessageId(
  rows: MsgRow[],
): Promise<Map<string, MessageTiming>> {
  const timings = new Map<string, MessageTiming>()
  for (const message of rows) {
    if (message.reasoningDurationMs === null && message.generationDurationMs === null) continue
    timings.set(message.id, {
      reasoningDurationMs: message.reasoningDurationMs,
      generationDurationMs: message.generationDurationMs,
    })
  }

  const runIds = rows.map((m) => m.runId).filter((runId): runId is string => Boolean(runId))
  if (runIds.length === 0) return timings
  const uniqueRunIds = [...new Set(runIds)]

  const runRows = await db
    .select({
      runId: runs.id,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      requestParams: runs.requestParams,
      modelKind: models.kind,
      modelCapabilities: models.capabilities,
      modelAllowedEfforts: models.allowedEfforts,
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
                allowedEfforts: row.modelAllowedEfforts,
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
  const finishedAtByRun = new Map(runRows.map((row) => [row.runId, row.finishedAt]))
  if (reasoningRunIds.size > 0) {
    const eventRows = await db
      .select({
        runId: runEvents.runId,
        type: runEvents.type,
        sequenceNumber: runEvents.sequenceNumber,
        createdAt: runEvents.createdAt,
      })
      .from(runEvents)
      .where(
        and(
          inArray(runEvents.runId, [...reasoningRunIds]),
          inArray(runEvents.type, [...REASONING_TIMING_EVENT_TYPES]),
        ),
      )
      .orderBy(asc(runEvents.runId), asc(runEvents.sequenceNumber))

    const byRun = new Map<string, ReasoningTimingEvent[]>()
    for (const ev of eventRows) {
      const items = byRun.get(ev.runId) ?? []
      items.push(ev)
      byRun.set(ev.runId, items)
    }
    for (const runId of reasoningRunIds) {
      const duration = computeReasoningDurationMs(
        byRun.get(runId) ?? [],
        finishedAtByRun.get(runId) ?? null,
      )
      if (duration !== null) reasoningByRun.set(runId, duration)
    }
  }

  for (const m of rows) {
    if (!m.runId) continue
    const snapshot = timings.get(m.id)
    timings.set(m.id, {
      reasoningDurationMs: reasoningByRun.get(m.runId) ?? snapshot?.reasoningDurationMs ?? null,
      generationDurationMs: generationByRun.get(m.runId) ?? snapshot?.generationDurationMs ?? null,
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
    toMessageDTO(
      m,
      timings.get(m.id) ?? null,
      m.modelId ? (modelLabels.get(m.modelId) ?? null) : null,
    ),
  )
}

interface ConversationRunPreferenceRow {
  modelId: string | null
  requestParams: Record<string, unknown> | ModelParams | null
  modelKind: typeof models.$inferSelect.kind | null
  modelCapabilities: typeof models.$inferSelect.capabilities | null
  modelAllowedEfforts: typeof models.$inferSelect.allowedEfforts | null
  modelDefaultParams: typeof models.$inferSelect.defaultParams | null
  modelDefaultEffort: typeof models.$inferSelect.defaultEffort | null
  modelDefaultWebSearch: boolean | null
}

type ConversationRunPreferences = {
  modelId: string | null
  params: { web_search?: boolean; reasoning_effort?: ReasoningEffort } | null
}

function toConversationRunPreferences(
  row: ConversationRunPreferenceRow,
): ConversationRunPreferences {
  const rp = (row.requestParams ?? {}) as ModelParams
  const params: { web_search?: boolean; reasoning_effort?: ReasoningEffort } = {}

  if (row.modelCapabilities) {
    const modelConfig = {
      kind: row.modelKind ?? undefined,
      capabilities: row.modelCapabilities,
      allowedEfforts: row.modelAllowedEfforts,
      defaultParams: row.modelDefaultParams,
      defaultEffort: row.modelDefaultEffort,
      defaultWebSearch: row.modelDefaultWebSearch ?? false,
    }
    if (row.modelCapabilities.web_search) {
      params.web_search = effectiveWebSearchEnabled(modelConfig, rp)
    }
    const effort = effectiveReasoningEffort(modelConfig, rp)
    if (effort) params.reasoning_effort = effort
  } else {
    if (rp.web_search !== undefined) params.web_search = rp.web_search
    if (rp.reasoning_effort !== undefined) params.reasoning_effort = rp.reasoning_effort
  }

  return {
    modelId: row.modelId,
    params: Object.keys(params).length ? params : null,
  }
}

/**
 * 会话最近一次生成所用的模型与联网/思考参数（用于打开会话时恢复控件）。
 * 独立分支不复制 run 审计记录，因此在没有 run 时回退到会话保存的目标时点设置。
 */
export async function getConversationLastRun(
  conversationId: string,
): Promise<ConversationRunPreferences> {
  const [r] = await db
    .select({
      modelId: runs.modelId,
      requestParams: runs.requestParams,
      modelKind: models.kind,
      modelCapabilities: models.capabilities,
      modelAllowedEfforts: models.allowedEfforts,
      modelDefaultParams: models.defaultParams,
      modelDefaultEffort: models.defaultEffort,
      modelDefaultWebSearch: models.defaultWebSearch,
    })
    .from(runs)
    .leftJoin(models, eq(runs.modelId, models.id))
    .where(eq(runs.conversationId, conversationId))
    .orderBy(desc(runs.createdAt))
    .limit(1)
  if (r) return toConversationRunPreferences(r)

  const [fallback] = await db
    .select({
      modelId: conversations.modelId,
      requestParams: conversations.paramsOverride,
      modelKind: models.kind,
      modelCapabilities: models.capabilities,
      modelAllowedEfforts: models.allowedEfforts,
      modelDefaultParams: models.defaultParams,
      modelDefaultEffort: models.defaultEffort,
      modelDefaultWebSearch: models.defaultWebSearch,
    })
    .from(conversations)
    .leftJoin(models, eq(conversations.modelId, models.id))
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return fallback ? toConversationRunPreferences(fallback) : { modelId: null, params: null }
}

/**
 * 清空某用户的全部对话（级联删除 messages/runs/run_events），
 * 并删除其全部附件（行 + 磁盘文件；头像存于 users.avatarPath，不受影响）。
 * 返回被删除的会话数。
 */
export async function clearAllConversations(userId: string): Promise<number> {
  // 路径快照与 broad delete 必须是同一个 SQLite 事务：若分支复制先提交，快照会包含
  // 新附件；若清空先提交，分支提交前的源会话复核会失败。两种顺序都不会遗留孤儿文件。
  const { conversationCount, attachmentRows } = db.transaction(
    (tx) => {
      const convRows = tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .all()
      const rows = tx.select().from(attachments).where(eq(attachments.userId, userId)).all()

      tx.delete(conversations).where(eq(conversations.userId, userId)).run()
      if (rows.length > 0) tx.delete(attachments).where(eq(attachments.userId, userId)).run()

      return { conversationCount: convRows.length, attachmentRows: rows }
    },
    { behavior: 'immediate' },
  )

  for (const attachment of attachmentRows) removeUpload(attachment.storagePath)

  return conversationCount
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
    .where(
      inArray(
        messages.conversationId,
        convRows.map((c) => c.id),
      ),
    )
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
      const hit = path.find((msg) =>
        textFromContent(msg.content).toLocaleLowerCase().includes(needle),
      )
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
