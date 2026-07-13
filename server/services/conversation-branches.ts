import { and, eq, inArray } from 'drizzle-orm'
import { modelParamsSchema } from '@shared/schemas/model-config'
import type { ContentPart, ModelParams } from '@shared/types/domain'
import { db } from '../db/client'
import { attachments, conversations, messages, runs } from '../db/schema'
import { newId } from '../lib/id'
import { copyUpload, removeUpload } from '../storage/files'
import { buildPath, getConversationMessages, getOwnedConversation } from './conversations'

const BRANCH_TITLE_PREFIX = '分支 • '
const DEFAULT_CONVERSATION_TITLE = '新聊天'
const MAX_CONVERSATION_TITLE_LENGTH = 120
const INSERT_BATCH_SIZE = 300

class BranchSourceChangedError extends Error {}

type BranchErrorCode =
  | 'not_found'
  | 'assistant_message_required'
  | 'message_not_ready'
  | 'invalid_message_tree'
  | 'attachment_unavailable'

export type CreateConversationBranchResult =
  | { ok: true; conversationId: string }
  | {
      ok: false
      status: 400 | 404 | 409
      code: BranchErrorCode
      message: string
    }

/** 标题明确标出来源；置顶状态会重置，但仍留在原文件夹的整理上下文中。 */
export function branchConversationTitle(sourceTitle: string | null): string {
  const sourceName = sourceTitle?.trim() || DEFAULT_CONVERSATION_TITLE
  const title = `${BRANCH_TITLE_PREFIX}${sourceName}`
  if (title.length <= MAX_CONVERSATION_TITLE_LENGTH) return title

  // 与 z.string().max(120) 的 UTF-16 长度语义保持一致，同时避免把 emoji 的代理对截断。
  return title.slice(0, MAX_CONVERSATION_TITLE_LENGTH).replace(/[\uD800-\uDBFF]$/, '')
}

/** 只保留用户可调模型参数；run.requestParams 中的 clientLocale 等审计字段不能写进会话偏好。 */
function persistedModelParams(value: unknown): ModelParams | null {
  const parsed = modelParamsSchema.safeParse(value ?? {})
  if (!parsed.success || Object.keys(parsed.data).length === 0) return null
  return parsed.data
}

function attachmentIdFromPart(part: ContentPart): string | null {
  return 'attachment_id' in part ? part.attachment_id : null
}

function remapContent(
  content: ContentPart[],
  attachmentIdMap: ReadonlyMap<string, string>,
): ContentPart[] {
  return content.map((part): ContentPart => {
    if (!('attachment_id' in part)) return { ...part }
    return {
      ...part,
      attachment_id: attachmentIdMap.get(part.attachment_id) ?? part.attachment_id,
    }
  })
}

function isMissingFileError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

/**
 * 复制 root → 指定助手消息的单一路径为独立会话。
 *
 * 消息中的 runId 属于真实上游请求的审计来源，不能复制，否则会制造重复请求记录；新会话通过
 * conversations.modelId/paramsOverride 保存目标时点的续聊设置。附件则必须复制文件和数据库行，
 * 防止删除原会话后分支里的图片/文件失效。
 */
export async function createConversationBranch(
  userId: string,
  sourceConversationId: string,
  assistantMessageId: string,
): Promise<CreateConversationBranchResult> {
  const sourceConversation = await getOwnedConversation(userId, sourceConversationId)
  if (!sourceConversation) {
    return { ok: false, status: 404, code: 'not_found', message: '会话不存在' }
  }

  const allMessages = await getConversationMessages(sourceConversation.id)
  const targetMessage = allMessages.find((message) => message.id === assistantMessageId)
  if (!targetMessage) {
    return { ok: false, status: 404, code: 'not_found', message: '消息不存在' }
  }
  if (targetMessage.role !== 'assistant') {
    return {
      ok: false,
      status: 400,
      code: 'assistant_message_required',
      message: '只能从助手消息创建分支对话',
    }
  }

  const sourcePath = buildPath(allMessages, targetMessage.id)
  const hasContinuousParentChain = sourcePath.every((message, index) =>
    index === 0 ? message.parentId === null : message.parentId === sourcePath[index - 1]?.id,
  )
  if (
    sourcePath.length === 0 ||
    sourcePath.at(-1)?.id !== targetMessage.id ||
    !hasContinuousParentChain
  ) {
    return {
      ok: false,
      status: 409,
      code: 'invalid_message_tree',
      message: '原对话消息链不完整，无法创建分支对话',
    }
  }
  if (sourcePath.some((message) => message.status === 'streaming')) {
    return {
      ok: false,
      status: 409,
      code: 'message_not_ready',
      message: '消息仍在生成，请稍后再创建分支对话',
    }
  }

  const [targetRun] = targetMessage.runId
    ? await db
        .select({ state: runs.state, requestParams: runs.requestParams })
        .from(runs)
        .where(
          and(
            eq(runs.id, targetMessage.runId),
            eq(runs.conversationId, sourceConversation.id),
            eq(runs.userId, userId),
          ),
        )
        .limit(1)
    : []
  if (targetRun?.state === 'queued' || targetRun?.state === 'running') {
    return {
      ok: false,
      status: 409,
      code: 'message_not_ready',
      message: '消息仍在生成，请稍后再创建分支对话',
    }
  }

  const newConversationId = newId()
  const messageIdMap = new Map(sourcePath.map((message) => [message.id, newId()]))
  const targetMessageCopyId = messageIdMap.get(targetMessage.id)!

  const firstReferencingMessageByAttachment = new Map<string, string>()
  for (const message of sourcePath) {
    for (const part of message.content) {
      const attachmentId = attachmentIdFromPart(part)
      if (attachmentId && !firstReferencingMessageByAttachment.has(attachmentId)) {
        firstReferencingMessageByAttachment.set(attachmentId, message.id)
      }
    }
  }

  const referencedAttachmentIds = [...firstReferencingMessageByAttachment.keys()]
  const sourceAttachments =
    referencedAttachmentIds.length > 0
      ? await db
          .select()
          .from(attachments)
          .where(
            and(eq(attachments.userId, userId), inArray(attachments.id, referencedAttachmentIds)),
          )
      : []
  if (sourceAttachments.length !== referencedAttachmentIds.length) {
    return {
      ok: false,
      status: 409,
      code: 'attachment_unavailable',
      message: '原对话中的部分附件已不可用，无法创建完整分支',
    }
  }

  const attachmentIdMap = new Map(sourceAttachments.map((attachment) => [attachment.id, newId()]))
  const copiedStoragePaths: string[] = []
  const copiedAttachments: (typeof attachments.$inferInsert)[] = []
  try {
    for (const sourceAttachment of sourceAttachments) {
      const copiedAttachmentId = attachmentIdMap.get(sourceAttachment.id)!
      const storagePath = copyUpload(
        userId,
        copiedAttachmentId,
        sourceAttachment.filename,
        sourceAttachment.mime,
        sourceAttachment.storagePath,
      )
      copiedStoragePaths.push(storagePath)

      const sourceMessageId =
        sourceAttachment.messageId && messageIdMap.has(sourceAttachment.messageId)
          ? sourceAttachment.messageId
          : firstReferencingMessageByAttachment.get(sourceAttachment.id)
      copiedAttachments.push({
        id: copiedAttachmentId,
        userId,
        messageId: sourceMessageId ? (messageIdMap.get(sourceMessageId) ?? null) : null,
        kind: sourceAttachment.kind,
        mime: sourceAttachment.mime,
        filename: sourceAttachment.filename,
        byteSize: sourceAttachment.byteSize,
        storagePath,
        sha256: sourceAttachment.sha256,
        createdAt: sourceAttachment.createdAt,
      })
    }
  } catch (error) {
    for (const storagePath of copiedStoragePaths) removeUpload(storagePath)
    if (!isMissingFileError(error)) throw error
    return {
      ok: false,
      status: 409,
      code: 'attachment_unavailable',
      message: '原对话中的部分附件文件已缺失，无法创建完整分支',
    }
  }

  const copiedMessages: (typeof messages.$inferInsert)[] = sourcePath.map((sourceMessage) => ({
    id: messageIdMap.get(sourceMessage.id)!,
    conversationId: newConversationId,
    parentId: sourceMessage.parentId ? (messageIdMap.get(sourceMessage.parentId) ?? null) : null,
    role: sourceMessage.role,
    status: sourceMessage.status,
    content: remapContent(sourceMessage.content, attachmentIdMap),
    runtimeContext: sourceMessage.runtimeContext,
    modelId: sourceMessage.modelId,
    // run/事件/用量日志属于原始上游调用；消息内容与 token 快照已在消息行中完整保留。
    runId: null,
    reasoningSummary: sourceMessage.reasoningSummary,
    annotations: sourceMessage.annotations,
    inputTokens: sourceMessage.inputTokens,
    cacheWriteTokens: sourceMessage.cacheWriteTokens,
    cachedTokens: sourceMessage.cachedTokens,
    outputTokens: sourceMessage.outputTokens,
    reasoningTokens: sourceMessage.reasoningTokens,
    totalTokens: sourceMessage.totalTokens,
    errorMessage: sourceMessage.errorMessage,
    createdAt: sourceMessage.createdAt,
  }))

  const now = new Date()
  const targetParams = persistedModelParams(
    targetRun ? targetRun.requestParams : sourceConversation.paramsOverride,
  )
  try {
    db.transaction(
      (tx) => {
        // 初次读取与复制附件之间可能恰逢“删除原对话/清空全部对话”；提交前必须再次确认
        // 分支点仍存在，避免 clear-all 完成后又凭旧快照复活一个新会话。
        const sourceStillExists = tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, sourceConversation.id), eq(conversations.userId, userId)))
          .get()
        const targetStillExists = tx
          .select({ id: messages.id, role: messages.role })
          .from(messages)
          .where(
            and(
              eq(messages.id, targetMessage.id),
              eq(messages.conversationId, sourceConversation.id),
            ),
          )
          .get()
        const currentAttachmentCount =
          referencedAttachmentIds.length > 0
            ? tx
                .select({ id: attachments.id })
                .from(attachments)
                .where(
                  and(
                    eq(attachments.userId, userId),
                    inArray(attachments.id, referencedAttachmentIds),
                  ),
                )
                .all().length
            : 0
        if (
          !sourceStillExists ||
          targetStillExists?.role !== 'assistant' ||
          currentAttachmentCount !== referencedAttachmentIds.length
        ) {
          throw new BranchSourceChangedError()
        }

        tx.insert(conversations)
          .values({
            id: newConversationId,
            userId,
            title: branchConversationTitle(sourceConversation.title),
            modelId: targetMessage.modelId ?? sourceConversation.modelId,
            folderId: sourceConversation.folderId,
            activeLeafId: targetMessageCopyId,
            paramsOverride: targetParams,
            archived: false,
            pinnedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        // 单条 INSERT 的 SQLite 参数数有限；长对话与大量附件在同一事务内分块写入。
        for (let offset = 0; offset < copiedMessages.length; offset += INSERT_BATCH_SIZE) {
          tx.insert(messages)
            .values(copiedMessages.slice(offset, offset + INSERT_BATCH_SIZE))
            .run()
        }
        for (let offset = 0; offset < copiedAttachments.length; offset += INSERT_BATCH_SIZE) {
          tx.insert(attachments)
            .values(copiedAttachments.slice(offset, offset + INSERT_BATCH_SIZE))
            .run()
        }
      },
      // 先取得写锁，避免跨进程 WAL 连接从旧读快照升级写事务时触发 BUSY_SNAPSHOT。
      { behavior: 'immediate' },
    )
  } catch (error) {
    for (const storagePath of copiedStoragePaths) removeUpload(storagePath)
    if (error instanceof BranchSourceChangedError) {
      return { ok: false, status: 404, code: 'not_found', message: '会话或消息已不存在' }
    }
    throw error
  }

  return { ok: true, conversationId: newConversationId }
}
