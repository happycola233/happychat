import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL('./migrations/0026_usage_pricing_snapshots.sql', import.meta.url),
)

describe('usage pricing snapshot migration', () => {
  it('backfills existing logs from the model price available at migration time', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`
        CREATE TABLE models (id text PRIMARY KEY, pricing text);
        CREATE TABLE usage_logs (id text PRIMARY KEY, model_id text);
      `)
      const insertModel = sqlite.prepare('INSERT INTO models (id, pricing) VALUES (?, ?)')
      const insertUsage = sqlite.prepare('INSERT INTO usage_logs (id, model_id) VALUES (?, ?)')
      const pricing = JSON.stringify({ input: 2, output: 8 })
      insertModel.run('priced-model', pricing)
      insertModel.run('unpriced-model', null)
      insertUsage.run('priced-log', 'priced-model')
      insertUsage.run('unpriced-log', 'unpriced-model')
      insertUsage.run('deleted-model-log', null)

      const migrationSql = readFileSync(migrationPath, 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      )
      sqlite.exec(migrationSql)

      const rows = sqlite
        .prepare('SELECT id, pricing_snapshot AS pricingSnapshot FROM usage_logs ORDER BY id ASC')
        .all()
      expect(rows).toEqual([
        { id: 'deleted-model-log', pricingSnapshot: null },
        { id: 'priced-log', pricingSnapshot: pricing },
        { id: 'unpriced-log', pricingSnapshot: null },
      ])
    } finally {
      sqlite.close()
    }
  })
})
