import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './client'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/** 启动时执行迁移（migrate-on-boot）；也可通过 `npm run db:migrate` 独立运行。 */
export function runMigrations(): void {
  migrate(db, { migrationsFolder })
}

// 作为脚本直接运行时执行迁移
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
  console.log('数据库迁移完成')
}
