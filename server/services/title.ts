import { and, desc, eq } from 'drizzle-orm'
import { DEFAULT_TITLE_PROMPT } from '@shared/constants'
import { textFromContent } from '@shared/util/contentText'
import { titleLocaleFromBrowser } from '@shared/util/titleLocale'
import { db } from '../db/client'
import { conversations, models, providers, runs } from '../db/schema'
import { providerClientFromRow } from '../provider/client'
import { parseResponse } from '../provider/normalize'
import { buildPath, getConversationMessages } from './conversations'
import { getAppConfig } from './appConfig'
import { conversationEvents } from './conversation-events'
import { getFirstRunnableTextModel, getRunnableModel } from './models'

type ModelRow = typeof models.$inferSelect
type ProviderRow = typeof providers.$inferSelect

/** 清洗模型输出为标题：去引号/取首行/去尾标点/限长。 */
export function cleanTitle(raw: string): string {
  let t = raw.trim()
  t = t.split('\n')[0]!.trim()
  t = t.replace(/^["'“”『「]+|["'“”』」]+$/g, '').trim()
  t = t.replace(/[。.!！?？,，、;；:：]+$/g, '').trim()
  return t.slice(0, 40)
}

async function resolveTitleModel(
  titleModelId: string | null,
  userId: string,
): Promise<{ model: ModelRow; provider: ProviderRow } | null> {
  if (titleModelId) {
    const preferred = await getRunnableModel(titleModelId, userId)
    if (preferred && preferred.model.kind !== 'image') return preferred
  }
  // 回退同样受当前会话所有者的模型范围约束；无可用模型时走本地标题，不做隐藏旁路调用。
  return getFirstRunnableTextModel(userId)
}

async function callTitleModel(m: ModelRow, p: ProviderRow, prompt: string): Promise<string> {
  const client = providerClientFromRow(p)
  if (m.kind === 'chat') {
    const resp = (await client.createChat({
      model: m.modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      stream: false,
    })) as { choices?: { message?: { content?: string } }[] }
    return resp.choices?.[0]?.message?.content ?? ''
  }
  const resp = await client.createResponse({
    model: m.modelId,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    max_output_tokens: 1024,
    store: false,
  })
  return parseResponse(resp).text
}

async function titleLocaleForRun(conversationId: string, runId?: string): Promise<string> {
  const [row] = await db
    .select({ requestParams: runs.requestParams })
    .from(runs)
    .where(
      runId
        ? and(eq(runs.id, runId), eq(runs.conversationId, conversationId))
        : eq(runs.conversationId, conversationId),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1)

  return titleLocaleFromBrowser(
    (row?.requestParams as { clientLocale?: unknown } | null | undefined)?.clientLocale,
  )
}

/**
 * 首条助手回复完成后异步生成标题（仅当会话尚无标题）。失败回退首条用户消息切片。
 * 在 finalizeRun 成功分支 fire-and-forget 调用。
 */
export async function maybeGenerateTitle(conversationId: string, runId?: string): Promise<void> {
  try {
    const cfg = await getAppConfig()
    if (!cfg.titleEnabled) return
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    if (!conv || conv.title) return // 已有标题（用户命名或已生成）→ 跳过

    const all = await getConversationMessages(conversationId)
    const path = buildPath(all, conv.activeLeafId)
    if (path.length === 0) return

    const firstUser = path.find((m) => m.role === 'user')
    const fallback =
      (firstUser ? textFromContent(firstUser.content).trim().slice(0, 20) : '') || '新聊天'

    const recent = path.slice(-4)
    const content = recent
      .map(
        (m) =>
          `${m.role === 'user' ? 'User' : 'Assistant'}: ${textFromContent(m.content).slice(0, 500)}`,
      )
      .join('\n')

    const resolved = await resolveTitleModel(cfg.titleModelId, conv.userId)
    if (!resolved) {
      const updatedAt = new Date()
      await db
        .update(conversations)
        .set({ title: fallback, updatedAt })
        .where(eq(conversations.id, conversationId))
      conversationEvents.emitTitleUpdated(conv.userId, conversationId, fallback, updatedAt)
      return
    }
    const titleLocale = await titleLocaleForRun(conversationId, runId)
    const prompt = (cfg.titlePrompt || DEFAULT_TITLE_PROMPT)
      .replaceAll('{locale}', titleLocale)
      .replaceAll('{content}', content)
    const raw = await callTitleModel(resolved.model, resolved.provider, prompt)
    const title = cleanTitle(raw) || fallback
    const updatedAt = new Date()
    await db
      .update(conversations)
      .set({ title, updatedAt })
      .where(eq(conversations.id, conversationId))
    conversationEvents.emitTitleUpdated(conv.userId, conversationId, title, updatedAt)
  } catch (e) {
    console.error('标题生成失败:', e)
  }
}
