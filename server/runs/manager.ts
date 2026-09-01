import { and, eq, inArray } from 'drizzle-orm'
import type { ModelParams } from '@shared/types/domain'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { db } from '../db/client'
import { messages, models, providers, runs, usageLogs } from '../db/schema'
import { computeGenerationDurationMs } from '../services/run-timing'
import { getReasoningDurationSnapshot } from '../services/run-timing-snapshot'
import { runChatEngine } from './chat-engine'
import { runAnthropicEngine } from './anthropic-engine'
import { runEngine } from './engine'
import { runImageEngine } from './image-run'
import type { EngineContext } from './types'

/** 进程内 run 管理器单例：保活生成（客户端断开不影响），支持中止。 */
class RunManager {
  private active = new Map<string, AbortController>()

  start(ctx: Omit<EngineContext, 'abortController'>): void {
    const ac = new AbortController()
    this.active.set(ctx.run.id, ac)
    const engine =
      ctx.model.kind === 'image'
        ? runImageEngine
        : ctx.model.kind === 'anthropic'
          ? runAnthropicEngine
          : ctx.model.kind === 'chat'
            ? runChatEngine
            : runEngine
    void engine({ ...ctx, abortController: ac })
      .catch((e) => console.error('run engine 未捕获错误:', e))
      .finally(() => this.active.delete(ctx.run.id))
  }

  abort(runId: string): boolean {
    const ac = this.active.get(runId)
    if (!ac) return false
    ac.abort()
    return true
  }

  isActive(runId: string): boolean {
    return this.active.has(runId)
  }
}

export const runManager = new RunManager()

/** 启动恢复：进程重启时把未完成的 run 标记为 interrupted（无 worker/Redis 的已知限制）。 */
export async function recoverInterruptedRuns(): Promise<void> {
  const stuck = await db
    .select()
    .from(runs)
    .where(inArray(runs.state, ['queued', 'running']))
  let recoveredCount = 0
  for (const r of stuck) {
    const finishedAt = new Date()
    const [model] = r.modelId
      ? await db.select().from(models).where(eq(models.id, r.modelId)).limit(1)
      : []
    const [provider] = model
      ? await db.select().from(providers).where(eq(providers.id, model.providerId)).limit(1)
      : []
    const reasoningDurationMs = isReasoningEnabled(model, r.requestParams as ModelParams | null)
      ? await getReasoningDurationSnapshot(r.id, finishedAt)
      : null
    const recovered = db.transaction((tx) => {
      const recoveredRun = tx
        .update(runs)
        .set({ state: 'interrupted', finishedAt })
        .where(and(eq(runs.id, r.id), inArray(runs.state, ['queued', 'running'])))
        .returning({ id: runs.id })
        .get()
      if (!recoveredRun) return false

      if (r.assistantMessageId) {
        tx.update(messages)
          .set({
            status: 'interrupted',
            errorMessage: '生成被中断（服务已重启）',
            // 进程中断没有可信终态 Response，不能保留可能在终结写入中途留下的重放信封。
            providerReplayContext: null,
            reasoningDurationMs,
            generationDurationMs: computeGenerationDurationMs(r.startedAt, finishedAt),
          })
          .where(eq(messages.id, r.assistantMessageId))
          .run()
      }

      // queued 尚未发起上游调用；running 才补一条零用量终态，使请求审计能解释服务重启。
      if (r.state === 'running') {
        const existingUsage = tx
          .select({ id: usageLogs.id })
          .from(usageLogs)
          .where(eq(usageLogs.runId, r.id))
          .get()
        if (!existingUsage) {
          tx.insert(usageLogs)
            .values({
              runId: r.id,
              userId: r.userId,
              modelId: model?.id ?? null,
              providerId: provider?.id ?? null,
              modelLabel: model?.modelId ?? null,
              modelDisplayName: model?.displayName ?? null,
              providerLabel: provider?.name ?? null,
              pricingSnapshot: model?.pricing ?? null,
              conversationId: r.conversationId,
              quotaAt: r.createdAt,
              outcome: 'interrupted',
              terminalReason: 'server_restart',
              // 与取消一致：不是上游失败，且已开始的请求仍沿用既有请求额度口径。
              success: true,
            })
            .run()
        }
      }
      return true
    })
    if (recovered) recoveredCount += 1
  }
  if (recoveredCount) {
    console.log(`已将 ${recoveredCount} 个未完成的生成标记为 interrupted`)
  }
}
