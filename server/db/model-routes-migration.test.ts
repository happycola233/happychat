import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, describe, expect, it, vi } from 'vitest'

const tmpDir = mkdtempSync(join(tmpdir(), 'happychat-model-routes-migration-'))

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** 把迁移目录裁剪到 0059，模拟升级前的生产库。 */
function migrateTo0059(dbPath: string) {
  const folder = join(tmpDir, 'migrations-0059')
  cpSync(new URL('./migrations', import.meta.url), folder, { recursive: true })
  const journalPath = join(folder, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[]
  }
  journal.entries = journal.entries.filter((entry) => entry.tag < '0060')
  writeFileSync(journalPath, JSON.stringify(journal))
  const sqlite = new Database(dbPath)
  sqlite.pragma('foreign_keys = ON')
  migrate(drizzle(sqlite), { migrationsFolder: folder })
  return sqlite
}

describe('0060 model routes migration', () => {
  it('把原供应商转为第一条线路，重建 models 时不级联清空任何引用', async () => {
    const dbPath = join(tmpDir, 'upgrade.db')
    const sqlite = migrateTo0059(dbPath)
    const now = Date.now()
    sqlite.exec(`
      INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u1', 'alice', 'h', 'user', ${now});
      INSERT INTO providers (id, name, base_url, api_key, protocol, enabled, created_at, updated_at, extra_headers)
        VALUES ('p1', 'Primary', 'https://a.test/v1', 'k', 'openai', 1, ${now}, ${now}, '{}');
      INSERT INTO models (id, provider_id, model_id, display_name, kind, enabled, capabilities, pricing, sort, created_at, updated_at)
        VALUES ('m1', 'p1', 'gpt-x', 'GPT X', 'responses', 1, '{}', '{"input":1,"output":2}', 0, ${now}, ${now});
      INSERT INTO model_user_access (model_id, user_id) VALUES ('m1', 'u1');
      INSERT INTO conversations (id, user_id, model_id, archived, created_at, updated_at) VALUES ('c1', 'u1', 'm1', 0, ${now}, ${now});
      INSERT INTO messages (id, conversation_id, role, status, content, model_id, bookmarked, created_at)
        VALUES ('msg1', 'c1', 'assistant', 'complete', '[]', 'm1', 0, ${now});
      INSERT INTO usage_logs (id, user_id, model_id, provider_id, cost_usd, cost_cny, cost_breakdown, kind, outcome, success, created_at)
        VALUES ('log1', 'u1', 'm1', 'p1', 0.5, 3.5,
          '{"chatUsd":0.3,"imageUsd":0.2,"totalUsd":0.5,"totalCny":3.5,"imageCount":1,"imageStatus":"complete","exchangeRate":{"usdToCny":7,"fetchedAt":1},"charges":[{"kind":"chat","currency":"USD","amount":0.3,"period":"基础价格","startedAt":1},{"kind":"image","currency":"CNY","amount":1.4,"period":"基础价格","startedAt":1}]}',
          'chat', 'completed', 1, ${now});
      INSERT INTO usage_logs (id, user_id, model_id, provider_id, kind, outcome, success, created_at)
        VALUES ('legacy', 'u1', 'm1', 'p1', 'chat', 'completed', 1, ${now});
    `)
    sqlite.close()

    process.env.NODE_ENV = 'test'
    process.env.DATA_DIR = tmpDir
    process.env.DATABASE_URL = dbPath
    process.env.SESSION_SECRET = 'test-session-secret-model-routes'
    vi.resetModules()
    const { runMigrations } = await import('./migrate')
    const client = await import('./client')
    try {
      runMigrations()
      const db = client.sqlite
      const route = db.prepare('SELECT * FROM model_routes').get() as Record<string, unknown>
      expect(route).toMatchObject({
        model_id: 'm1',
        provider_id: 'p1',
        upstream_model_id: null,
        priority: 0,
        weight: 1,
        enabled: 1,
        cost_pricing: null,
      })
      expect(String(route.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/)
      const columns = (db.prepare('PRAGMA table_info(models)').all() as { name: string }[]).map(
        (column) => column.name,
      )
      expect(columns).not.toContain('provider_id')
      // 子表引用全部保留：重建若在外键开启时执行会把它们清空或置空。
      expect(db.prepare('SELECT model_id FROM conversations').get()).toEqual({ model_id: 'm1' })
      expect(db.prepare('SELECT model_id FROM messages').get()).toEqual({ model_id: 'm1' })
      expect(db.prepare('SELECT count(*) AS n FROM model_user_access').get()).toEqual({ n: 1 })
      expect(db.prepare("SELECT * FROM usage_logs WHERE id = 'log1'").get()).toMatchObject({
        model_id: 'm1',
        route_id: route.id,
        upstream_cost_usd: 0.5,
        upstream_cost_cny: 3.5,
        image_cost_usd: 0.2,
        image_cost_cny: 1.4,
      })
      expect(db.prepare("SELECT * FROM usage_logs WHERE id = 'legacy'").get()).toMatchObject({
        route_id: route.id,
        upstream_cost_usd: null,
        image_cost_usd: null,
      })
      // 删除模型应级联删除线路，删除线路只把日志引用置空。
      db.prepare('DELETE FROM model_routes WHERE id = ?').run(route.id)
      expect(db.prepare("SELECT route_id FROM usage_logs WHERE id = 'log1'").get()).toEqual({
        route_id: null,
      })
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally {
      client.sqlite.close()
    }
  })
})
