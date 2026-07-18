import { eq, inArray } from 'drizzle-orm'
import type { ModelParams } from '@shared/types/domain'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { db } from '../db/client'
import { messages, models, runs } from '../db/schema'
import { computeGenerationDurationMs } from '../services/run-timing'
import { getReasoningDurationSnapshot } from '../services/run-timing-snapshot'
import { runChatEngine } from './chat-engine'
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
  for (const r of stuck) {
    const finishedAt = new Date()
    const [model] = r.modelId
      ? await db.select().from(models).where(eq(models.id, r.modelId)).limit(1)
      : []
    const reasoningDurationMs = isReasoningEnabled(model, r.requestParams as ModelParams | null)
      ? await getReasoningDurationSnapshot(r.id, finishedAt)
      : null
    await db.update(runs).set({ state: 'interrupted', finishedAt }).where(eq(runs.id, r.id))
    if (r.assistantMessageId) {
      await db
        .update(messages)
        .set({
          status: 'interrupted',
          errorMessage: '生成被中断（服务已重启）',
          // 进程中断没有可信终态 Response，不能保留可能在终结写入中途留下的重放信封。
          reasoningReplayContext: null,
          reasoningDurationMs,
          generationDurationMs: computeGenerationDurationMs(r.startedAt, finishedAt),
        })
        .where(eq(messages.id, r.assistantMessageId))
    }
  }
  if (stuck.length) {
    console.log(`已将 ${stuck.length} 个未完成的生成标记为 interrupted`)
  }
}
