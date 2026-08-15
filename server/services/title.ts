import { and, desc, eq } from 'drizzle-orm'
import { DEFAULT_TITLE_PROMPT } from '@shared/constants'
import type { MessageUsage, UsageOutcome } from '@shared/types/domain'
import { textFromContent } from '@shared/util/contentText'
import { anthropicModelProfile } from '@shared/util/anthropic'
import { titleLocaleFromBrowser } from '@shared/util/titleLocale'
import { db } from '../db/client'
import { conversations, models, providers, runs, usageLogs } from '../db/schema'
import { mapAnthropicUsage, type AnthropicUsage } from '../provider/anthropic'
import { classifyAnthropicTerminal } from '../provider/anthropic-terminal'
import { mapChatUsage } from '../provider/chat'
import type { ChatChunk } from '../provider/chat'
import { classifyChatTerminal } from '../provider/chat-terminal'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import { parseResponse } from '../provider/normalize'
import { classifyResponsesTerminal } from '../provider/responses-terminal'
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
  // 回退仍受当前会话所有者的模型范围约束；无可用模型时走本地标题，不做隐藏旁路调用。
  return getFirstRunnableTextModel(userId)
}

/** 标题调用的结果：正文、上游用量与终态，成功和失败都必须进入请求审计。 */
interface TitleModelResult {
  text: string
  usage: MessageUsage
  success: boolean
  errorType: string | null
  outcome: UsageOutcome
  terminalReason: string | null
}

const EMPTY_USAGE: MessageUsage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
}

function titleTerminalResult(terminal: {
  state: 'completed' | 'incomplete' | 'failed'
  incompleteReason: string | null
  errorType: string | null
}): Pick<TitleModelResult, 'success' | 'errorType' | 'outcome' | 'terminalReason'> {
  return {
    success: terminal.state !== 'failed',
    errorType: terminal.errorType,
    outcome: terminal.state,
    terminalReason: terminal.errorType ?? terminal.incompleteReason,
  }
}

async function callTitleModel(
  m: ModelRow,
  p: ProviderRow,
  prompt: string,
): Promise<TitleModelResult> {
  const client = providerClientFromRow(p)
  if (m.kind === 'chat') {
    const resp = (await client.createChat({
      model: m.modelId,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 512,
      stream: false,
    })) as {
      choices?: {
        message?: { content?: string | null; refusal?: string | null }
        finish_reason?: string | null
      }[]
      usage?: ChatChunk['usage']
    }
    const choice = resp.choices?.[0] ?? {}
    return {
      text: choice.message?.content ?? '',
      usage: mapChatUsage(resp.usage),
      ...titleTerminalResult(
        classifyChatTerminal({
          finishReason: choice.finish_reason,
          refusalObserved: Boolean(choice.message?.refusal),
        }),
      ),
    }
  }
  if (m.kind === 'anthropic') {
    const body: Record<string, unknown> = {
      model: m.modelId,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      max_tokens: 512,
    }
    const profile = anthropicModelProfile(m.modelId)
    // Sonnet 5 等型号默认开启 adaptive thinking；标题任务显式关闭，避免 512 token 被思考耗尽。
    if (profile.thinkingDefaultsOn && profile.canDisableThinking) {
      body.thinking = { type: 'disabled' }
    } else if (profile.thinkingDefaultsOn) {
      body.output_config = { effort: 'low' }
    }
    const resp = (await client.createAnthropicMessage(body)) as {
      content?: { type?: string; text?: string }[]
      usage?: AnthropicUsage
      stop_reason?: string | null
    }
    return {
      text: (resp.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
      usage: mapAnthropicUsage(resp.usage),
      ...titleTerminalResult(classifyAnthropicTerminal(resp.stop_reason)),
    }
  }
  const resp = await client.createResponse({
    model: m.modelId,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    max_output_tokens: 1024,
    store: false,
  })
  const parsed = parseResponse(resp)
  const terminal = classifyResponsesTerminal(resp)
  return {
    text: parsed.text,
    usage: parsed.usage,
    ...titleTerminalResult(terminal),
  }
}

/**
 * 记账标题调用的真实用量。
 *
 * 标题总结没有 run（不走 `runs` 表，也没有助手消息），因此 `run_id` 为空，
 * 靠 `kind='title'` 与对话请求区分；成本口径与 finalize 完全一致（同一份价格快照）。
 * 用户额度只聚合 `kind='chat'`，所以这里保留真实审计日志，但不写额度归属时刻。
 * 失败调用也写审计行，但标记 `success=false`；拿不到上游用量的网络/HTTP 异常以 0 记账。
 */
async function logTitleUsage(
  conversationId: string,
  userId: string,
  model: ModelRow,
  provider: ProviderRow,
  usage: MessageUsage,
  success: boolean,
  errorType: string | null,
  outcome: UsageOutcome,
  terminalReason: string | null,
): Promise<void> {
  await db.insert(usageLogs).values({
    userId,
    modelId: model.id,
    providerId: provider.id,
    modelLabel: model.modelId,
    providerLabel: provider.name,
    pricingSnapshot: model.pricing,
    conversationId,
    kind: 'title',
    inputTokens: usage.inputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cachedTokens: usage.cachedTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    success,
    errorType,
    outcome,
    terminalReason,
  })
}

function titleCallError(error: unknown): { errorType: string; terminalReason: string } {
  if (error instanceof UpstreamError) {
    return {
      errorType: error.type ?? 'upstream_error',
      terminalReason: error.code ?? error.type ?? 'upstream_error',
    }
  }
  return { errorType: 'upstream_error', terminalReason: 'upstream_error' }
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
    let result: TitleModelResult
    try {
      result = await callTitleModel(resolved.model, resolved.provider, prompt)
    } catch (error) {
      console.error('标题模型调用失败:', error)
      const { errorType, terminalReason } = titleCallError(error)
      result = {
        text: '',
        usage: EMPTY_USAGE,
        success: false,
        errorType,
        outcome: 'failed',
        terminalReason,
      }
    }
    await logTitleUsage(
      conversationId,
      conv.userId,
      resolved.model,
      resolved.provider,
      result.usage,
      result.success,
      result.errorType,
      result.outcome,
      result.terminalReason,
    )
    const title = (result.success ? cleanTitle(result.text) : '') || fallback
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
