import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'
import type { ContentPart } from '@shared/types/domain'
import { db } from '../db/client'
import { attachments, conversations, messages } from '../db/schema'
import { removeUploadStrict } from '../storage/files'

/** 未绑定上传的保留期：满 24 小时后才有资格被回收。 */
export const ORPHAN_ATTACHMENT_RETENTION_MS = 24 * 60 * 60 * 1000
/** 每小时扫描一次，使正常负载下的实际回收时间落在上传后的约 24～25 小时内。 */
export const ORPHAN_ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const MAX_ORPHAN_ATTACHMENTS_PER_BATCH = 1_000
const ATTACHMENT_LOOKUP_CHUNK_SIZE = 500
const MESSAGE_SCAN_PAGE_SIZE = 250
const CLEANUP_YIELD_EVERY = 25
const MAX_FAILURE_SAMPLES = 5

export interface AttachmentCleanupFailure {
  attachmentId: string
  operation: 'repair_reference' | 'delete'
  error: unknown
}

export interface AttachmentCleanupResult {
  deletedCount: number
  /** 修复历史异常数据：消息已引用附件，但 messageId 仍为空。 */
  repairedReferenceCount: number
  failedCount: number
  /** 仅保留少量样本，避免异常积压时把所有 Error 长期留在内存中。 */
  failures: AttachmentCleanupFailure[]
}

interface CleanupOptions {
  now?: Date
  /** 测试可注入失败；生产默认使用会抛出非 ENOENT 错误的严格删除。 */
  removeFile?: (storagePath: string) => void
  /** 服务器关闭时在安全的批次边界停止；默认完成全部积压。 */
  shouldContinue?: () => boolean
}

function attachmentIdFromPart(part: ContentPart): string | null {
  if (part.type === 'input_image' || part.type === 'input_file' || part.type === 'image_result') {
    return part.attachment_id
  }
  return null
}

function messageReferencesAttachment(content: ContentPart[], attachmentId: string): boolean {
  return content.some((part) => attachmentIdFromPart(part) === attachmentId)
}

interface HistoricalReference {
  conversationId: string
  messageId: string
  userId: string
}

interface HistoricalReferenceAudit {
  completed: boolean
  protectedAttachmentIds: Set<string>
  repairedReferenceCount: number
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

/**
 * 历史版本曾在“插入消息”和“绑定附件”之间留下崩溃窗口。每次完整清理只分页
 * 扫描一次消息表，并只记录仍过期且未绑定的引用。若同一附件横跨多个会话，
 * 保持未绑定并保护它；只有引用全在一个会话时才修复 messageId，避免后续删除
 * 任一会话时破坏另一个会话。扫描不持写锁，每页都会让出事件循环。
 */
async function auditHistoricalReferences(
  cutoff: Date,
  shouldContinue: () => boolean,
  recordFailure: (failure: AttachmentCleanupFailure) => void,
): Promise<HistoricalReferenceAudit> {
  const references = new Map<string, Map<string, HistoricalReference>>()
  let cursor: string | null = null

  while (shouldContinue()) {
    const page: Array<{
      id: string
      conversationId: string
      userId: string
      content: ContentPart[]
    }> = cursor
      ? await db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            userId: conversations.userId,
            content: messages.content,
          })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .where(gt(messages.id, cursor))
          .orderBy(asc(messages.id))
          .limit(MESSAGE_SCAN_PAGE_SIZE)
      : await db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            userId: conversations.userId,
            content: messages.content,
          })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .orderBy(asc(messages.id))
          .limit(MESSAGE_SCAN_PAGE_SIZE)

    const pageReferences = new Map<string, Map<string, HistoricalReference>>()
    for (const message of page) {
      for (const part of message.content) {
        const attachmentId = attachmentIdFromPart(part)
        if (!attachmentId) continue
        const byConversation = pageReferences.get(attachmentId) ?? new Map()
        if (!byConversation.has(message.conversationId)) {
          byConversation.set(message.conversationId, {
            conversationId: message.conversationId,
            messageId: message.id,
            userId: message.userId,
          })
          pageReferences.set(attachmentId, byConversation)
        }
      }
    }

    for (const attachmentIds of chunks([...pageReferences.keys()], ATTACHMENT_LOOKUP_CHUNK_SIZE)) {
      if (attachmentIds.length === 0) continue
      const orphanRows = await db
        .select({ id: attachments.id, userId: attachments.userId })
        .from(attachments)
        .where(
          and(
            inArray(attachments.id, attachmentIds),
            isNull(attachments.messageId),
            lte(attachments.createdAt, cutoff),
          ),
        )

      for (const attachment of orphanRows) {
        const pageConversations = pageReferences.get(attachment.id)
        if (!pageConversations) continue
        const allConversations = references.get(attachment.id) ?? new Map()
        for (const [conversationId, reference] of pageConversations) {
          // 污染数据中的跨用户引用既不能认领，也不应阻止附件所有者的正常回收。
          if (reference.userId !== attachment.userId || allConversations.has(conversationId)) {
            continue
          }
          allConversations.set(conversationId, reference)
        }
        if (allConversations.size > 0) references.set(attachment.id, allConversations)
      }
    }

    if (page.length < MESSAGE_SCAN_PAGE_SIZE) break
    cursor = page.at(-1)?.id ?? null
    if (!cursor) break
    await yieldToEventLoop()
  }

  const protectedAttachmentIds = new Set(references.keys())
  if (!shouldContinue()) {
    return { completed: false, protectedAttachmentIds, repairedReferenceCount: 0 }
  }

  let repairedReferenceCount = 0
  let processedCount = 0
  for (const [attachmentId, byConversation] of references) {
    if (!shouldContinue()) {
      return { completed: false, protectedAttachmentIds, repairedReferenceCount }
    }
    processedCount += 1
    // 多会话引用无法用单值 messageId 准确表达，宁可保留到引用关系收敛。
    if (byConversation.size !== 1) {
      if (processedCount % CLEANUP_YIELD_EVERY === 0) await yieldToEventLoop()
      continue
    }
    const reference = byConversation.values().next().value as HistoricalReference | undefined
    if (!reference) continue

    try {
      const outcome = db.transaction(
        (tx): 'repaired' | 'already_claimed' | 'reference_missing' => {
          const message = tx
            .select({ content: messages.content })
            .from(messages)
            .innerJoin(conversations, eq(messages.conversationId, conversations.id))
            .where(
              and(
                eq(messages.id, reference.messageId),
                eq(messages.conversationId, reference.conversationId),
                eq(conversations.userId, reference.userId),
              ),
            )
            .get()
          if (!message || !messageReferencesAttachment(message.content, attachmentId)) {
            return 'reference_missing'
          }

          const repaired = tx
            .update(attachments)
            .set({ messageId: reference.messageId })
            .where(
              and(
                eq(attachments.id, attachmentId),
                eq(attachments.userId, reference.userId),
                isNull(attachments.messageId),
                lte(attachments.createdAt, cutoff),
              ),
            )
            .returning({ id: attachments.id })
            .get()
          return repaired ? 'repaired' : 'already_claimed'
        },
        { behavior: 'immediate' },
      )

      if (outcome === 'repaired') repairedReferenceCount += 1
      if (outcome !== 'reference_missing') protectedAttachmentIds.delete(attachmentId)
    } catch (error) {
      // 修复失败时继续保护该附件，本轮绝不进入删除分支。
      recordFailure({ attachmentId, operation: 'repair_reference', error })
    }

    if (processedCount % CLEANUP_YIELD_EVERY === 0) await yieldToEventLoop()
  }

  return { completed: true, protectedAttachmentIds, repairedReferenceCount }
}

/**
 * 删除创建已满 24 小时、仍未绑定消息且没有被任何消息内容引用的上传。
 *
 * 最终的历史引用修复和逐项删除都使用 IMMEDIATE 事务，和发送侧的最终附件
 * 复核/绑定事务串行：发送先完成则 messageId 已非空；清理先完成则发送侧会
 * 发现附件已不存在并返回 400。单批设有上限，调度器通过 keyset 游标继续
 * 后续批次，既让出事件循环，也避免失败的最老条目长期阻塞其他候选。
 */
export async function cleanupExpiredOrphanAttachments(
  options: CleanupOptions = {},
): Promise<AttachmentCleanupResult> {
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - ORPHAN_ATTACHMENT_RETENTION_MS)
  const removeFile = options.removeFile ?? removeUploadStrict
  const shouldContinue = options.shouldContinue ?? (() => true)
  const failureSamples: AttachmentCleanupFailure[] = []
  let failedCount = 0
  const recordFailure = (failure: AttachmentCleanupFailure) => {
    failedCount += 1
    if (failureSamples.length < MAX_FAILURE_SAMPLES) failureSamples.push(failure)
  }

  const firstCandidate = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(isNull(attachments.messageId), lte(attachments.createdAt, cutoff)))
    .limit(1)
  if (firstCandidate.length === 0 || !shouldContinue()) {
    return {
      deletedCount: 0,
      repairedReferenceCount: 0,
      failedCount,
      failures: failureSamples,
    }
  }

  // 先完成一次全局历史审计，再开始所有 TTL 批次；避免 B 个批次重复扫描 B 次消息表。
  const audit = await auditHistoricalReferences(cutoff, shouldContinue, recordFailure)
  if (!audit.completed) {
    return {
      deletedCount: 0,
      repairedReferenceCount: audit.repairedReferenceCount,
      failedCount,
      failures: failureSamples,
    }
  }

  let cursor: { createdAt: Date; id: string } | undefined
  let deletedCount = 0
  let processedCount = 0
  while (shouldContinue()) {
    const eligibleAfterCursor = cursor
      ? or(
          gt(attachments.createdAt, cursor.createdAt),
          and(eq(attachments.createdAt, cursor.createdAt), gt(attachments.id, cursor.id)),
        )
      : undefined
    const candidateRows = await db
      .select({ id: attachments.id, createdAt: attachments.createdAt })
      .from(attachments)
      .where(
        and(isNull(attachments.messageId), lte(attachments.createdAt, cutoff), eligibleAfterCursor),
      )
      .orderBy(asc(attachments.createdAt), asc(attachments.id))
      .limit(MAX_ORPHAN_ATTACHMENTS_PER_BATCH + 1)

    const hasMore = candidateRows.length > MAX_ORPHAN_ATTACHMENTS_PER_BATCH
    const candidates = candidateRows.slice(0, MAX_ORPHAN_ATTACHMENTS_PER_BATCH)
    if (candidates.length === 0) break

    for (const candidate of candidates) {
      if (!audit.protectedAttachmentIds.has(candidate.id)) {
        try {
          const deleted = db.transaction(
            (tx) => {
              // 审计后附件可能已被发送绑定；删除时必须再次核验全部 TTL 条件。
              const claimed = tx
                .delete(attachments)
                .where(
                  and(
                    eq(attachments.id, candidate.id),
                    isNull(attachments.messageId),
                    lte(attachments.createdAt, cutoff),
                  ),
                )
                .returning({ storagePath: attachments.storagePath })
                .get()
              if (!claimed) return false

              // unlink 失败会回滚 DB 行；极端的提交失败窗口由发送侧磁盘存在性复核兜底。
              removeFile(claimed.storagePath)
              return true
            },
            { behavior: 'immediate' },
          )
          if (deleted) deletedCount += 1
        } catch (error) {
          recordFailure({ attachmentId: candidate.id, operation: 'delete', error })
        }
      }

      processedCount += 1
      if (processedCount % CLEANUP_YIELD_EVERY === 0) await yieldToEventLoop()
    }

    if (!hasMore) break
    const lastCandidate = candidates.at(-1)
    if (!lastCandidate) break
    cursor = { createdAt: lastCandidate.createdAt, id: lastCandidate.id }
    // 失败项留在游标之前，后续候选仍继续处理；下一次小时扫描会从头重试失败项。
    await yieldToEventLoop()
  }

  return {
    deletedCount,
    repairedReferenceCount: audit.repairedReferenceCount,
    failedCount,
    failures: failureSamples,
  }
}

type CleanupTask = () => Promise<AttachmentCleanupResult>
type CleanupLogger = Pick<Console, 'log' | 'error'>

interface CleanupSchedulerOptions {
  cleanup?: CleanupTask
  intervalMs?: number
  logger?: CleanupLogger
}

/**
 * 启动孤立附件清理调度：立即执行一次，之后按固定周期执行。
 * 返回停止函数，便于服务器关闭和单元测试显式释放定时器。
 */
export function startOrphanAttachmentCleanupScheduler(
  options: CleanupSchedulerOptions = {},
): () => void {
  const cleanup =
    options.cleanup ?? (() => cleanupExpiredOrphanAttachments({ shouldContinue: () => !stopped }))
  const intervalMs = options.intervalMs ?? ORPHAN_ATTACHMENT_CLEANUP_INTERVAL_MS
  const logger = options.logger ?? console
  let running = false
  let stopped = false

  const run = async () => {
    if (running || stopped) return
    running = true
    try {
      const result = await cleanup()
      if (result.deletedCount > 0 || result.repairedReferenceCount > 0) {
        logger.log(
          `孤立附件清理完成：删除 ${result.deletedCount} 个，修复 ${result.repairedReferenceCount} 个历史引用`,
        )
      }
      for (const failure of result.failures) {
        logger.error(
          `孤立附件清理条目失败（attachmentId=${failure.attachmentId}, operation=${failure.operation}）：`,
          failure.error,
        )
      }
      if (result.failedCount > result.failures.length) {
        logger.error(
          `另有 ${result.failedCount - result.failures.length} 个附件清理错误将在下一轮重试`,
        )
      }
    } catch (error) {
      // 一次扫描失败不能终止后续调度。
      logger.error('孤立附件清理失败：', error)
    } finally {
      running = false
    }
  }

  void run()
  const timer = setInterval(() => void run(), intervalMs)
  // 后台维护任务不应成为 Node 进程无法退出的唯一原因。
  timer.unref()

  return () => {
    stopped = true
    clearInterval(timer)
  }
}
