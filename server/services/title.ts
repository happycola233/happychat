import { and, asc, desc, eq, ne } from 'drizzle-orm'
import { textFromContent } from '@shared/util/contentText'
import { titleLocaleFromBrowser } from '@shared/util/titleLocale'
import { db } from '../db/client'
import { conversations, models, providers, runs } from '../db/schema'
import { providerClientFromRow } from '../provider/client'
import { parseResponse } from '../provider/normalize'
import { buildPath, getConversationMessages } from './conversations'
import { getAppConfig } from './appConfig'

type ModelRow = typeof models.$inferSelect
type ProviderRow = typeof providers.$inferSelect

export const DEFAULT_TITLE_PROMPT = `I will give you some dialogue content in the \`<content>\` block.
You need to summarize the conversation between user and assistant into a short title.
1. The title language should be consistent with the user's primary language
2. Do not use punctuation or other special symbols
3. Reply directly with the title
4. Summarize using {locale} language
5. The title should not exceed 12 characters

<content>
{content}
</content>`

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
): Promise<{ model: ModelRow; provider: ProviderRow } | null> {
  if (titleModelId) {
    const [row] = await db
      .select()
      .from(models)
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(eq(models.id, titleModelId))
      .limit(1)
    if (row && row.models.enabled && row.providers.enabled && row.models.kind !== 'image') {
      return { model: row.models, provider: row.providers }
    }
  }
  // 回退：首个可用文本模型
  const [row] = await db
    .select()
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(eq(models.enabled, true), eq(providers.enabled, true), ne(models.kind, 'image')))
    .orderBy(asc(models.sort))
    .limit(1)
  return row ? { model: row.models, provider: row.providers } : null
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

    const resolved = await resolveTitleModel(cfg.titleModelId)
    if (!resolved) {
      await db.update(conversations).set({ title: fallback }).where(eq(conversations.id, conversationId))
      return
    }
    const titleLocale = await titleLocaleForRun(conversationId, runId)
    const prompt = (cfg.titlePrompt || DEFAULT_TITLE_PROMPT)
      .replaceAll('{locale}', titleLocale)
      .replaceAll('{content}', content)
    const raw = await callTitleModel(resolved.model, resolved.provider, prompt)
    const title = cleanTitle(raw) || fallback
    await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId))
  } catch (e) {
    console.error('标题生成失败:', e)
  }
}
