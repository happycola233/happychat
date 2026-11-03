import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db, sqlite } from './client'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * 启动时执行迁移（migrate-on-boot）；也可通过 `npm run db:migrate` 独立运行。
 *
 * drizzle 把全部待执行迁移包在一个事务里，而 SQLite 在事务内忽略 `PRAGMA foreign_keys`。
 * 迁移文件里「建新表 → 拷数据 → DROP 旧表 → RENAME」的重建步骤若在外键开启时执行，
 * DROP TABLE 的隐式 DELETE 会级联清空或置空所有引用它的子表（例如重建 models 会抹掉
 * 会话、消息与用量日志里的模型引用）。因此在事务外关闭外键，结束后恢复并做一次完整性检查。
 */
export function runMigrations(): void {
  const appliedBefore = appliedMigrationCount()
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder })
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
  // 全库外键检查要扫描所有子表，只在本次确实执行了迁移时进行。
  if (appliedMigrationCount() === appliedBefore) return
  const violations = sqlite.pragma('foreign_key_check') as unknown[]
  if (violations.length > 0) {
    // 历史数据可能早已存在悬空引用；只告警不阻断启动，避免旧库因无关脏数据无法升级。
    console.warn(`数据库迁移后发现 ${violations.length} 条外键不一致记录`, violations.slice(0, 5))
  }
}

function appliedMigrationCount(): number {
  const table = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  if (!table) return 0
  return (sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n
}

// 作为脚本直接运行时执行迁移
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
  console.log('数据库迁移完成')
}
