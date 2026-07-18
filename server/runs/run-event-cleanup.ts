import { eq, sql } from 'drizzle-orm'
import { db, type DB } from '../db/client'
import { runEvents } from '../db/schema'
import { sanitizeEventData } from './event-sanitize'

// 只匹配 JSON 字符串值；净化后的 null 不再命中，因此清理天然幂等且会自终止。
const ENCRYPTED_CONTENT_STRING_PATTERN = '%"encrypted_content":"%'

/**
 * 清除历史 run_events 中已经落库的 reasoning 密文。
 * 返回实际更新的行数，供启动日志与测试确认清理结果。
 */
export function sanitizePersistedRunEvents(database: DB = db): number {
  const rows = database
    .select({ id: runEvents.id, type: runEvents.type, data: runEvents.data })
    .from(runEvents)
    .where(sql`${runEvents.data} LIKE ${ENCRYPTED_CONTENT_STRING_PATTERN}`)
    .all()

  let updatedCount = 0
  database.transaction((tx) => {
    for (const row of rows) {
      const sanitizedData = sanitizeEventData(row.type, row.data)
      // LIKE 只负责缩小扫描范围；若密文位于非协议字段，不能误改该行。
      if (sanitizedData === row.data) continue
      tx.update(runEvents).set({ data: sanitizedData }).where(eq(runEvents.id, row.id)).run()
      updatedCount += 1
    }
  })

  return updatedCount
}
