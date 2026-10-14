import { and, eq } from 'drizzle-orm'
import type { RetryAuditSummary } from '@shared/types/retry'
import type { db } from '../db/client'
import { errorLogs } from '../db/schema'

type AuditDatabase = Pick<typeof db, 'select' | 'insert' | 'update'>

/** 首次失败立即落库；重试与最终结算更新同一行，避免重复统计错误事件。 */
export function saveRunErrorAudit(
  database: AuditDatabase,
  runId: string,
  userId: string,
  summary: RetryAuditSummary,
): void {
  const lastFailure = summary.failures.at(-1)!
  const existing = database
    .select({ id: errorLogs.id })
    .from(errorLogs)
    .where(and(eq(errorLogs.runId, runId), eq(errorLogs.scope, 'upstream')))
    .get()
  const values = {
    errorType: lastFailure.errorType,
    code: lastFailure.errorCode,
    httpStatus: lastFailure.httpStatus,
    message: lastFailure.message,
    detail: { retry: summary },
  }
  if (existing) {
    database.update(errorLogs).set(values).where(eq(errorLogs.id, existing.id)).run()
  } else {
    database
      .insert(errorLogs)
      .values({
        ...values,
        runId,
        userId,
        scope: 'upstream',
        createdAt: new Date(lastFailure.failedAt),
      })
      .run()
  }
}
