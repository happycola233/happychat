import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { env } from '../env'
import * as schema from './schema'

const dbPath = env.DATABASE_URL
const dir = dirname(dbPath)
if (dir && dir !== '.' && !existsSync(dir)) {
  mkdirSync(dir, { recursive: true })
}

export const sqlite = new Database(dbPath)
// WAL：更好的并发读写；NORMAL：兼顾安全与性能；外键：开启级联；busy_timeout：减少写锁竞争报错。
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('synchronous = NORMAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 5000')

export const db = drizzle(sqlite, { schema })
export type DB = typeof db
